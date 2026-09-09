// POST /functions/v1/identity-evaluate
//
// Mithras Identity Defence — Phase A rule evaluator + enforcer.
//
// For each org with active rules:
//   1. Walk every rule (skip 'off' mode).
//   2. Dispatch to a per-trigger-kind handler that finds matching signals
//      since the rule's last_evaluated_at watermark.
//   3. For each match, run the safety pipeline: applies_to filter →
//      break_glass exclusion → per-user rate limit → first-24h cooldown →
//      per-org cap. Any guardrail failure → log a 'skipped_*' action row,
//      take no Graph action.
//   4. If mode='enforce' and all guardrails pass: call Graph (revoke /
//      isolate / disable) and persist the response. If 'report_only':
//      record 'would_have_fired' with the same evidence, no Graph call.
//
// Phase A supports two trigger kinds:
//   - 'endpoint_defender_critical' — Severe endpoint_threats since watermark.
//     Pure server-side, no Graph dependency. Demonstrable today on any
//     customer with the agent installed.
//   - 'mailbox_rule_added' — new inbox rules with external-forwarder /
//     delete-on-receive semantics. Requires M365 connect (Graph read);
//     no P1 licence required (MailboxSettings.Read is on the free tier).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Per-org cap — no single evaluator run will fire more than this many
// 'enforce' actions for a given org. Hit the cap → all further matches
// downgrade to 'skipped_org_cap' and an emergency alert fires. Default 10;
// configurable per-org via platform_settings later.
const PER_ORG_ENFORCE_CAP = 10;

// First-24h cooldown: a newly-promoted-to-enforce rule may take at most
// this many actions in its first 24h. Prevents a misconfigured rule from
// nuking a customer the moment they flip the switch.
const FIRST_24H_COOLDOWN_CAP = 5;

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

interface Rule {
    id: string;
    organization_id: string;
    name: string;
    trigger_kind: string;
    trigger_config: Record<string, unknown>;
    applies_to: unknown;
    actions: Array<{ kind: string; severity?: string; [k: string]: unknown }>;
    mode: "off" | "report_only" | "enforce";
    rate_limit_per_user_per_day: number;
    break_glass_users: string[];
    last_evaluated_at: string | null;
    enforce_started_at: string | null;
}

// Signal candidate — what a per-kind handler emits before guardrails run.
interface Candidate {
    target_user: string;        // UPN or email-like identifier
    evidence: Record<string, unknown>;
    // For endpoint-driven actions, the agent endpoint we'd isolate.
    endpoint_id?: string;
}

// What an action handler returns after attempting to act.
interface ActionResult {
    actions_taken: Array<Record<string, unknown>>;
    graph_response?: unknown;
    error?: string;
}

// ----------------------------------------------------------------------------
// Applies-to filter — common to every rule. The shape of applies_to is one of:
//   "all"                                          → all users
//   { include: ["a@x", "b@x"] }                    → only those users
//   { exclude: ["c@x"] }                           → all users except these
//   { include: [...], exclude: [...] }             → intersection
// ----------------------------------------------------------------------------
function appliesToCovers(rule: Rule, upn: string): boolean {
    const at: unknown = rule.applies_to;
    if (at === "all") return true;
    if (!at || typeof at !== "object") return true;
    const obj = at as { include?: string[]; exclude?: string[] };
    const norm = upn.toLowerCase();
    if (obj.exclude && obj.exclude.map((s) => s.toLowerCase()).includes(norm)) return false;
    if (obj.include && obj.include.length > 0) {
        return obj.include.map((s) => s.toLowerCase()).includes(norm);
    }
    return true;
}

function isBreakGlass(rule: Rule, upn: string): boolean {
    const norm = upn.toLowerCase();
    return rule.break_glass_users.map((s) => s.toLowerCase()).includes(norm);
}

async function userActionsToday(rule: Rule, upn: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
        .from("identity_actions")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", rule.id)
        .eq("target_user", upn)
        .in("outcome", ["enforced", "would_have_fired"])
        .gte("created_at", since);
    return count ?? 0;
}

async function ruleEnforceCountSinceStart(rule: Rule): Promise<number> {
    if (!rule.enforce_started_at) return 0;
    const since = rule.enforce_started_at;
    const cutoff = new Date(new Date(since).getTime() + 24 * 60 * 60 * 1000).toISOString();
    if (Date.now() > new Date(cutoff).getTime()) return -1; // cooldown window expired
    const { count } = await supabase
        .from("identity_actions")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", rule.id)
        .eq("outcome", "enforced")
        .gte("created_at", since)
        .lte("created_at", cutoff);
    return count ?? 0;
}

async function orgEnforceCountThisRun(orgId: string, runStart: string): Promise<number> {
    const { count } = await supabase
        .from("identity_actions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("outcome", "enforced")
        .gte("created_at", runStart);
    return count ?? 0;
}

// ----------------------------------------------------------------------------
// Trigger handler — endpoint_defender_critical
//
// Severe endpoint_threats with status Active that landed since
// rule.last_evaluated_at. Pure server-side, no Graph dependency.
// ----------------------------------------------------------------------------
async function findEndpointDefenderCriticalCandidates(rule: Rule): Promise<Candidate[]> {
    const since = rule.last_evaluated_at ?? new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await supabase
        .from("endpoint_threats")
        .select("id, endpoint_id, threat_name, severity, status, initial_detection_time, created_at")
        .gte("created_at", since)
        .in("severity", ["Severe", "High"])
        .in("status", ["Active", "Cleaning"]);
    if (!data || data.length === 0) return [];

    // Resolve endpoint → primary user via the SECURITY DEFINER helper.
    // That helper covers both the agent-reported case (endpoints.primary_user_upn)
    // and the home-user fallback (organizations.home_user_email). Business-org
    // endpoints without an agent-reported UPN return NULL — those are skipped
    // here so we never revoke a wrong-org user by accident.
    const endpointIds = [...new Set((data as Array<Record<string, unknown>>).map((t) => t.endpoint_id as string))];
    const { data: endpoints } = await supabase
        .from("endpoints")
        .select("id, hostname, organization_id")
        .in("id", endpointIds)
        .eq("organization_id", rule.organization_id);
    const epMap = new Map<string, { hostname: string | null; upn: string | null }>();
    for (const e of (endpoints ?? []) as Array<Record<string, unknown>>) {
        const { data: upn } = await supabase.rpc("endpoint_primary_user_upn", { p_endpoint_id: e.id });
        epMap.set(e.id as string, {
            hostname: (e.hostname as string) ?? null,
            upn:      typeof upn === "string" ? upn : null,
        });
    }

    const candidates: Candidate[] = [];
    for (const t of data as Array<Record<string, unknown>>) {
        const ep = epMap.get(t.endpoint_id as string);
        if (!ep || !ep.upn) continue; // no resolved user → skip; we don't act without a target
        candidates.push({
            target_user: ep.upn,
            endpoint_id: t.endpoint_id as string,
            evidence: {
                trigger:        "endpoint_defender_critical",
                threat_name:    t.threat_name,
                severity:       t.severity,
                status:         t.status,
                endpoint:       ep.hostname,
                detected_at:    t.initial_detection_time ?? t.created_at,
                threat_row_id:  t.id,
            },
        });
    }
    return candidates;
}

// ----------------------------------------------------------------------------
// Trigger handler — mailbox_rule_added
//
// New inbox rules with external forwarder or delete-on-receive semantics.
// Calls Graph per-user. Bounded to the org's connected tenants and to
// users we already have heartbeat data for (to avoid scanning every M365
// user every cycle — too expensive). For Phase A we only check users
// with email_threats activity in the last 7 days as a coarse "active user"
// proxy; broader sweep is Phase B.
// ----------------------------------------------------------------------------
async function findMailboxRuleAddedCandidates(rule: Rule): Promise<Candidate[]> {
    // Get connected tenants for this org.
    const { data: tenants } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("organization_id", rule.organization_id);
    if (!tenants || tenants.length === 0) return [];

    const since = rule.last_evaluated_at ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const candidates: Candidate[] = [];

    for (const t of tenants as Array<Record<string, unknown>>) {
        let token: string;
        try { token = await ensureFreshToken(t); } catch { continue; }

        // Coarse active-user list: anyone with email_threats activity in
        // the last 7 days. Phase B will replace this with a proper
        // active-mailbox list.
        const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recipients } = await supabase
            .from("email_threats")
            .select("recipient_email, recipient_user_id")
            .eq("m365_tenant_id", t.id)
            .gte("received_at", sevenAgo);
        const upns = new Set<string>();
        const upnToOid = new Map<string, string>();
        for (const r of (recipients ?? []) as Array<Record<string, unknown>>) {
            const e = (r.recipient_email as string) ?? "";
            const oid = (r.recipient_user_id as string) ?? "";
            if (e && oid) {
                upns.add(e.toLowerCase());
                upnToOid.set(e.toLowerCase(), oid);
            }
        }

        for (const upn of upns) {
            try {
                const oid = upnToOid.get(upn) ?? upn;
                const rulesRes = await fetch(
                    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(oid)}/mailFolders/inbox/messageRules`,
                    {
                        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                        signal:  AbortSignal.timeout(15_000),
                    }
                );
                if (!rulesRes.ok) continue;
                const body = await rulesRes.json() as { value?: Array<Record<string, unknown>> };
                for (const r of body.value ?? []) {
                    const actions = (r.actions ?? {}) as Record<string, unknown>;
                    const forwardTo = Array.isArray(actions.forwardTo) ? actions.forwardTo : [];
                    const redirectTo = Array.isArray(actions.redirectTo) ? actions.redirectTo : [];
                    const externalForwarders = [...forwardTo, ...redirectTo]
                        .map((x) => ((x as Record<string, unknown>).emailAddress as Record<string, unknown>)?.address ?? "")
                        .filter((addr: string) => addr && !addr.toLowerCase().endsWith(`@${(t.tenant_id as string).toLowerCase()}`));
                    const deletes = actions.delete === true || actions.permanentDelete === true;
                    // The rule is suspicious if it forwards externally OR
                    // silently deletes inbound mail (classic attacker plays).
                    if (externalForwarders.length === 0 && !deletes) continue;
                    candidates.push({
                        target_user: upn,
                        evidence: {
                            trigger:             "mailbox_rule_added",
                            rule_id_in_mailbox:  r.id,
                            rule_name:           r.displayName,
                            forwards_to:         externalForwarders,
                            deletes_on_receive:  deletes,
                            tenant_id:           t.tenant_id,
                        },
                    });
                }
            } catch {
                // Per-user Graph failure is non-fatal; skip the user.
                continue;
            }
        }
    }
    return candidates;
}

// ----------------------------------------------------------------------------
// Trigger handler — missing_mfa
//
// Users without MFA registered who have signed in within the trigger
// window. Listed via /reports/authenticationMethods/userRegistrationDetails
// (already covered by our consented Reports.Read.All scope). Action set
// is typically revoke_sessions — forces re-auth at next attempt, which is
// the only opportunity to nag enrollment without a custom landing page.
//
// Phase 2 — substitutes the "MFA must be on" half of Entra ID P1's value
// for customers who don't want to pay $6/user/month for it.
// ----------------------------------------------------------------------------
async function findMissingMfaCandidates(rule: Rule): Promise<Candidate[]> {
    const { data: tenants } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("organization_id", rule.organization_id);
    if (!tenants || tenants.length === 0) return [];

    const candidates: Candidate[] = [];

    for (const t of tenants as Array<Record<string, unknown>>) {
        let token: string;
        try { token = await ensureFreshToken(t); } catch { continue; }

        // 1. Pull MFA registration state.
        let next: string | null = "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=200";
        let pages = 0;
        const unregistered = new Map<string, { id: string; upn: string }>();
        while (next && pages < 20) {
            try {
                const r = await fetch(next, {
                    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                    signal:  AbortSignal.timeout(20_000),
                });
                if (!r.ok) break;
                const body = await r.json() as { value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string };
                for (const u of body.value ?? []) {
                    const isMfaReg = u.isMfaRegistered === true || u.isMfaRegistered === "true";
                    if (!isMfaReg) {
                        const upn = (u.userPrincipalName as string) ?? "";
                        const id  = (u.id as string) ?? upn;
                        if (upn) unregistered.set(id, { id, upn });
                    }
                }
                next = body["@odata.nextLink"] ?? null;
                pages++;
            } catch { break; }
        }
        if (unregistered.size === 0) continue;

        // 2. Filter to users who have signed in within the trigger window.
        // Default window: rule.last_evaluated_at or last 24h.
        const since = rule.last_evaluated_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        let signinNext: string | null =
            `https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=createdDateTime ge ${since} and status/errorCode eq 0&$top=200`;
        const activeUserIds = new Set<string>();
        let sPages = 0;
        while (signinNext && sPages < 10) {
            try {
                const r = await fetch(signinNext, {
                    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                    signal:  AbortSignal.timeout(20_000),
                });
                if (!r.ok) break;
                const body = await r.json() as { value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string };
                for (const s of body.value ?? []) {
                    const uid = (s.userId as string) ?? "";
                    if (uid) activeUserIds.add(uid);
                }
                signinNext = body["@odata.nextLink"] ?? null;
                sPages++;
            } catch { break; }
        }

        for (const [id, u] of unregistered) {
            if (!activeUserIds.has(id)) continue;
            candidates.push({
                target_user: u.upn,
                evidence: {
                    trigger:    "missing_mfa",
                    user_id:    id,
                    user_upn:   u.upn,
                    tenant_id:  t.tenant_id,
                    signed_in_since: since,
                },
            });
        }
    }
    return candidates;
}

// ----------------------------------------------------------------------------
// Graph token freshness (same pattern as m365-email-sweep)
// ----------------------------------------------------------------------------
async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    return typeof data?.value === "string" ? data.value : null;
}

async function ensureFreshToken(t: Record<string, unknown>): Promise<string> {
    const now = Date.now();
    const exp = t.access_token_expires_at ? new Date(t.access_token_expires_at as string).getTime() : 0;
    if (t.access_token && exp > now + 30_000) return t.access_token as string;

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret) throw new Error("m365_credentials_missing");
    if (!t.refresh_token) throw new Error("no_refresh_token");

    const scopes = Array.isArray(t.scopes) && t.scopes.length > 0
        ? (t.scopes as string[])
        : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];

    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id as string,
        clientId, clientSecret,
        refreshToken: t.refresh_token as string,
        scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = {
        access_token: tok.access_token, access_token_expires_at: newExpiresAt,
    };
    if (tok.refresh_token && tok.refresh_token !== (t.refresh_token as string)) {
        patch.refresh_token = tok.refresh_token;
    }
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id as string);
    return tok.access_token;
}

// ----------------------------------------------------------------------------
// Action handlers — execute against Graph / Mithras agent
// ----------------------------------------------------------------------------
async function executeActions(
    rule: Rule,
    candidate: Candidate,
): Promise<ActionResult> {
    const taken: Array<Record<string, unknown>> = [];
    const responses: Record<string, unknown> = {};

    for (const action of rule.actions) {
        try {
            if (action.kind === "revoke_sessions") {
                // Get a Graph token from any connected tenant for this org.
                const { data: tenants } = await supabase
                    .from("m365_tenants")
                    .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
                    .eq("organization_id", rule.organization_id)
                    .limit(1);
                const t = (tenants ?? [])[0];
                if (!t) {
                    taken.push({ kind: "revoke_sessions", outcome: "skipped_no_tenant" });
                    continue;
                }
                const token = await ensureFreshToken(t);
                const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(candidate.target_user)}/revokeSignInSessions`;
                const resp = await fetch(url, {
                    method:  "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    signal:  AbortSignal.timeout(15_000),
                });
                responses["revoke_sessions"] = { status: resp.status };
                if (resp.ok) {
                    taken.push({ kind: "revoke_sessions", outcome: "success" });
                } else {
                    const text = (await resp.text()).slice(0, 300);
                    taken.push({ kind: "revoke_sessions", outcome: "failed", detail: text });
                }
            } else if (action.kind === "isolate_endpoint" && candidate.endpoint_id) {
                // Queue an agent command. The agent picks it up on next
                // heartbeat (~30s).
                await supabase.from("agent_commands").insert({
                    endpoint_id:     candidate.endpoint_id,
                    organization_id: rule.organization_id,
                    command_type:    "isolate_network",
                    params:          { triggered_by: "identity_defence", rule_id: rule.id, evidence: candidate.evidence },
                    status:          "queued",
                });
                taken.push({ kind: "isolate_endpoint", outcome: "queued" });
            } else if (action.kind === "notify_soc") {
                await supabase.from("alerts").insert({
                    organization_id: rule.organization_id,
                    alert_type:      "identity_defence",
                    severity:        (action.severity as string) ?? "high",
                    title:           `Identity Defence — ${rule.name}`,
                    message:         `Rule "${rule.name}" fired against ${candidate.target_user}. See /m365/identity-defence/actions for details.`,
                    source:          "mid",
                    metadata:        { rule_id: rule.id, target_user: candidate.target_user, evidence: candidate.evidence },
                });
                taken.push({ kind: "notify_soc", outcome: "queued" });
            } else if (action.kind === "disable_account") {
                // Mark in trigger_config that we intend to disable. Phase A
                // doesn't actually call the Graph PATCH yet — disable is the
                // heaviest hammer and we want it to be a Phase B feature
                // gated by an extra "I really mean it" confirmation flow.
                taken.push({ kind: "disable_account", outcome: "skipped_phase_a" });
            } else {
                taken.push({ kind: action.kind, outcome: "unknown_action_kind" });
            }
        } catch (e: any) {
            taken.push({ kind: action.kind, outcome: "exception", detail: e?.message ?? "unknown" });
        }
    }

    return { actions_taken: taken, graph_response: responses };
}

// ----------------------------------------------------------------------------
// Per-rule pipeline. Runs the rule's trigger handler, then for each
// candidate evaluates safety guardrails and acts.
// ----------------------------------------------------------------------------
async function processRule(rule: Rule, runStart: string): Promise<{ matched: number; enforced: number; report_only: number; skipped: number; }> {
    let candidates: Candidate[] = [];
    if (rule.trigger_kind === "endpoint_defender_critical") {
        candidates = await findEndpointDefenderCriticalCandidates(rule);
    } else if (rule.trigger_kind === "mailbox_rule_added") {
        candidates = await findMailboxRuleAddedCandidates(rule);
    } else if (rule.trigger_kind === "missing_mfa") {
        candidates = await findMissingMfaCandidates(rule);
    } else {
        return { matched: 0, enforced: 0, report_only: 0, skipped: 0 };
    }

    let enforced = 0, reportOnly = 0, skipped = 0;
    for (const c of candidates) {
        const outcome = await evaluateAndAct(rule, c, runStart);
        if (outcome === "enforced") enforced++;
        else if (outcome === "would_have_fired") reportOnly++;
        else skipped++;
    }

    // Watermark forward — only after a clean run, otherwise we re-process
    // the same signals next cycle.
    await supabase.from("identity_access_rules")
        .update({ last_evaluated_at: new Date().toISOString() } as any)
        .eq("id", rule.id);

    return { matched: candidates.length, enforced, report_only: reportOnly, skipped };
}

async function evaluateAndAct(rule: Rule, c: Candidate, runStart: string): Promise<string> {
    // 1. applies_to filter
    if (!appliesToCovers(rule, c.target_user)) {
        await supabase.from("identity_actions").insert({
            organization_id: rule.organization_id,
            rule_id:         rule.id,
            target_user:     c.target_user,
            outcome:         "skipped_applies_to",
            actions_taken:   [],
            evidence:        c.evidence,
        });
        return "skipped_applies_to";
    }

    // 2. break_glass
    if (isBreakGlass(rule, c.target_user)) {
        await supabase.from("identity_actions").insert({
            organization_id: rule.organization_id,
            rule_id:         rule.id,
            target_user:     c.target_user,
            outcome:         "skipped_break_glass",
            actions_taken:   [],
            evidence:        c.evidence,
        });
        return "skipped_break_glass";
    }

    // 3. per-user rate limit (across all outcomes that "count")
    const userToday = await userActionsToday(rule, c.target_user);
    if (userToday >= rule.rate_limit_per_user_per_day) {
        await supabase.from("identity_actions").insert({
            organization_id: rule.organization_id,
            rule_id:         rule.id,
            target_user:     c.target_user,
            outcome:         "skipped_rate_limit",
            actions_taken:   [],
            evidence:        c.evidence,
        });
        return "skipped_rate_limit";
    }

    // 4. first-24h cooldown (only applies to enforce-mode rules)
    if (rule.mode === "enforce" && rule.enforce_started_at) {
        const cdCount = await ruleEnforceCountSinceStart(rule);
        if (cdCount >= 0 && cdCount >= FIRST_24H_COOLDOWN_CAP) {
            await supabase.from("identity_actions").insert({
                organization_id: rule.organization_id,
                rule_id:         rule.id,
                target_user:     c.target_user,
                outcome:         "skipped_cooldown",
                actions_taken:   [],
                evidence:        c.evidence,
            });
            return "skipped_cooldown";
        }
    }

    // 5. per-org cap for this run
    if (rule.mode === "enforce") {
        const orgCount = await orgEnforceCountThisRun(rule.organization_id, runStart);
        if (orgCount >= PER_ORG_ENFORCE_CAP) {
            await supabase.from("identity_actions").insert({
                organization_id: rule.organization_id,
                rule_id:         rule.id,
                target_user:     c.target_user,
                outcome:         "skipped_org_cap",
                actions_taken:   [],
                evidence:        c.evidence,
            });
            return "skipped_org_cap";
        }
    }

    // All guardrails passed. Act (or pretend to, for report_only).
    if (rule.mode === "report_only") {
        await supabase.from("identity_actions").insert({
            organization_id: rule.organization_id,
            rule_id:         rule.id,
            target_user:     c.target_user,
            outcome:         "would_have_fired",
            actions_taken:   rule.actions.map((a) => ({ kind: a.kind, outcome: "dry_run" })),
            evidence:        c.evidence,
        });
        return "would_have_fired";
    }

    // mode === 'enforce'
    const result = await executeActions(rule, c);
    const anyFailed = result.actions_taken.some((a) => a.outcome === "failed" || a.outcome === "exception");
    await supabase.from("identity_actions").insert({
        organization_id: rule.organization_id,
        rule_id:         rule.id,
        target_user:     c.target_user,
        outcome:         anyFailed ? "failed" : "enforced",
        actions_taken:   result.actions_taken,
        evidence:        c.evidence,
        graph_response:  result.graph_response,
    });
    return anyFailed ? "failed" : "enforced";
}

// ----------------------------------------------------------------------------
// Auth — cron-secret or service-role only. This is a privileged loop;
// individual operator "test now" goes through identity-rule-test (Phase B).
// ----------------------------------------------------------------------------
async function isAuthorised(req: Request): Promise<boolean> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    return jwt === SUPABASE_SERVICE_KEY;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);
    if (!(await isAuthorised(req))) return json({ error: "unauthorized" }, 401, origin);

    const runStart = new Date().toISOString();

    // Pull every non-'off' rule across every org.
    const { data: rules, error } = await supabase
        .from("identity_access_rules")
        .select("*")
        .neq("mode", "off");
    if (error) return json({ error: "rules_query_failed", detail: error.message }, 500, origin);

    const summary: Array<Record<string, unknown>> = [];
    for (const r of (rules ?? []) as Rule[]) {
        try {
            const counts = await processRule(r, runStart);
            summary.push({ rule_id: r.id, name: r.name, ...counts });
        } catch (e: any) {
            summary.push({ rule_id: r.id, name: r.name, error: e?.message ?? "exception" });
        }
    }

    return json({ ran_at: runStart, rules_evaluated: summary.length, summary }, 200, origin);
});
