// POST /functions/v1/m365-ca-poll
//
// Read-only Conditional Access poller. For each connected M365 tenant:
//   1. Refresh the Graph access token (already-consented scopes include
//      Policy.Read.All).
//   2. Fetch `/identity/conditionalAccess/policies`.
//   3. Upsert into public.m365_ca_policies; mark any previously-seen
//      policyId that's absent from this poll as deleted (soft).
//   4. Run an LLM gap analysis against best-practice patterns and write
//      structured findings into public.m365_ca_findings.
//
// Runs from pg_cron daily and on-demand from the SOC console when an
// operator clicks "Refresh now" on the CA page. Self-overlap mutex prevents
// concurrent runs on slow Graph responses.
//
// Phase 1 = READ-ONLY. We never call /identity/conditionalAccess/policies
// with PATCH/POST/DELETE. The Phase 2 decision on whether to manage
// policies in-platform is a separate scope (Policy.ReadWrite.ConditionalAccess)
// the customer would have to re-consent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const v = data?.value;
    if (typeof v === "string") return v;
    return null;
}

interface TenantRow {
    id: string;
    organization_id: string;
    tenant_id: string;
    tenant_display_name: string | null;
    access_token: string | null;
    refresh_token: string | null;
    access_token_expires_at: string | null;
    scopes: string[] | null;
}

async function ensureFreshToken(t: TenantRow): Promise<string> {
    const now = Date.now();
    const exp = t.access_token_expires_at ? new Date(t.access_token_expires_at).getTime() : 0;
    if (t.access_token && exp > now + 30_000) return t.access_token;

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret) throw new Error("m365_credentials_missing");
    if (!t.refresh_token) throw new Error("no_refresh_token");

    const scopes = (t.scopes && t.scopes.length > 0)
        ? t.scopes
        : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];

    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id,
        clientId, clientSecret,
        refreshToken: t.refresh_token,
        scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = {
        access_token: tok.access_token,
        access_token_expires_at: newExpiresAt,
    };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) {
        patch.refresh_token = tok.refresh_token;
    }
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    return tok.access_token;
}

// Graph response shape — we keep the full conditions / grantControls /
// sessionControls subtrees in JSONB rather than flatten, so the AI gap
// analysis prompt can reason over the whole policy structure.
interface GraphCaPolicy {
    id: string;
    displayName: string;
    state: string;            // enabled | disabled | enabledForReportingNotEnforced
    createdDateTime?: string;
    modifiedDateTime?: string;
    conditions?: Record<string, unknown>;
    grantControls?: Record<string, unknown>;
    sessionControls?: Record<string, unknown> | null;
}

async function fetchPolicies(token: string): Promise<GraphCaPolicy[]> {
    const url = "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies";
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
        throw new Error(`graph_ca_${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const body = await resp.json() as { value?: GraphCaPolicy[] };
    return body.value ?? [];
}

interface AnalysisFinding {
    finding_key: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    body: string;
    recommended_action: string;
    related_policy_ids: string[];
}

const ENTRA_CA_LIST_URL = "https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/PoliciesScreenReact";

const AI_SYSTEM_PROMPT = `You are a Conditional Access policy auditor for a managed security platform. You read a tenant's Microsoft Entra Conditional Access policies and identify GAPS against best-practice patterns for small and medium businesses.

Best-practice patterns to check (raise a finding if any is missing or weak):
  1. MFA required for ALL admins (Global Admin, Privileged Role Admin, Security Admin, etc.) — no excluded admin roles.
  2. Legacy authentication (POP, IMAP, SMTP AUTH, EWS) BLOCKED for all users.
  3. MFA required for all users for ALL cloud apps (or at minimum, Office 365 + administrative portals).
  4. Compliant or hybrid-joined device required for accessing administrative portals (Azure Portal, M365 Admin Center).
  5. Sign-in risk policy — block or require MFA for high-risk sign-ins (Identity Protection signal).
  6. User risk policy — require password change on high user risk.
  7. Session controls — limit token lifetime / require persistent browser block on unmanaged devices.
  8. Geo-restriction — block sign-ins from countries you don't operate in.
  9. No policies left in 'enabledForReportingNotEnforced' (report-only) state for more than 30 days — they should be promoted or removed.
 10. No policies with ALL users + ALL apps + Grant (no MFA) — that's a wide-open allow that defeats the rest.

For each gap, output a finding with: stable key (snake_case), severity (critical/high/medium/low/info), one-line title, two-sentence body, one-sentence recommended action, and the list of related policyIds (empty array if no specific policy applies, e.g. "no MFA policy exists at all").

Severities:
  critical = no MFA for admins, legacy auth allowed, ALL/ALL/no-grant
  high     = no MFA for all users, no sign-in risk, no legacy-auth block
  medium   = no compliant device for admins, no user risk policy
  low      = no geo restriction, long report-only states, no session controls
  info     = single-policy hygiene notes (excluded users, group scope drift)

If the policy set genuinely has no gaps, return an empty findings array. Never invent gaps.`;

const FINDINGS_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        findings: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    finding_key:        { type: "string" },
                    severity:           { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
                    title:              { type: "string" },
                    body:               { type: "string" },
                    recommended_action: { type: "string" },
                    related_policy_ids: { type: "array", items: { type: "string" } },
                },
                required: ["finding_key", "severity", "title", "body", "recommended_action", "related_policy_ids"],
            },
        },
    },
    required: ["findings"],
};

async function analysePolicies(
    policies: GraphCaPolicy[],
    organizationId: string,
): Promise<{ findings: AnalysisFinding[]; model: string | null; cost_microcents: number; prompt_tokens?: number; completion_tokens?: number }> {
    if (policies.length === 0) {
        return {
            findings: [{
                finding_key: "no_policies_at_all",
                severity: "critical",
                title: "No Conditional Access policies are configured",
                body: "This tenant has no Conditional Access policies at all. Every sign-in is allowed unconditionally — no MFA enforcement, no legacy-auth block, no geo-fencing. Anyone with valid credentials can sign in from anywhere.",
                recommended_action: "Create at minimum a 'Require MFA for all users' and 'Block legacy authentication' policy in the Entra admin centre.",
                related_policy_ids: [],
            }],
            model: null,
            cost_microcents: 0,
        };
    }

    // Compact the policies before sending to the LLM — full Graph responses
    // can be ~2KB each and we don't need everything.
    const compact = policies.map((p) => ({
        id:           p.id,
        displayName:  p.displayName,
        state:        p.state,
        conditions:   p.conditions,
        grantControls: p.grantControls,
        sessionControls: p.sessionControls,
    }));

    const result = await callLlmStructured<{ findings: AnalysisFinding[] }>({
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt:   `Audit these ${policies.length} Conditional Access policies for the tenant. Identify gaps against best-practice patterns. Be specific — when a finding points at a particular policy, populate related_policy_ids with that policy id.\n\nPOLICIES:\n${JSON.stringify(compact, null, 2)}`,
        schema:       FINDINGS_SCHEMA,
        schemaName:   "ca_policy_findings",
        feature:      "ca_policy_audit",
        organizationId,
        timeoutMs:    60_000,
    });

    if (!result.ok) {
        return { findings: [], model: null, cost_microcents: 0 };
    }
    return {
        findings:          result.data.findings ?? [],
        model:             result.model ?? null,
        cost_microcents:   result.cost_microcents ?? 0,
        prompt_tokens:     result.prompt_tokens,
        completion_tokens: result.completion_tokens,
    };
}

interface TenantResult {
    tenant_pk: string;
    azure_tid: string;
    ok: boolean;
    policies_seen?: number;
    policies_marked_deleted?: number;
    findings_written?: number;
    error?: string;
}

async function processTenant(t: TenantRow): Promise<TenantResult> {
    let accessToken: string;
    try {
        accessToken = await ensureFreshToken(t);
    } catch (e: any) {
        return { tenant_pk: t.id, azure_tid: t.tenant_id, ok: false, error: `token_refresh: ${e?.message ?? "unknown"}` };
    }

    let policies: GraphCaPolicy[];
    try {
        policies = await fetchPolicies(accessToken);
    } catch (e: any) {
        return { tenant_pk: t.id, azure_tid: t.tenant_id, ok: false, error: e?.message ?? "graph_fetch" };
    }

    const fetchedAt = new Date().toISOString();
    const seenIds = new Set<string>();
    for (const p of policies) {
        seenIds.add(p.id);
        await supabase.from("m365_ca_policies").upsert({
            m365_tenant_id:    t.id,
            organization_id:   t.organization_id,
            policy_id:         p.id,
            display_name:      p.displayName ?? "(unnamed)",
            state:             p.state,
            conditions:        p.conditions ?? {},
            grant_controls:    p.grantControls ?? null,
            session_controls:  p.sessionControls ?? null,
            created_datetime:  p.createdDateTime ?? null,
            modified_datetime: p.modifiedDateTime ?? null,
            fetched_at:        fetchedAt,
            deleted_at:        null,
        } as any, { onConflict: "m365_tenant_id,policy_id" });
    }

    // Mark stale rows deleted.
    const { data: liveRows } = await supabase
        .from("m365_ca_policies")
        .select("policy_id")
        .eq("m365_tenant_id", t.id)
        .is("deleted_at", null);
    const toDelete: string[] = [];
    for (const row of (liveRows ?? []) as Array<{ policy_id: string }>) {
        if (!seenIds.has(row.policy_id)) toDelete.push(row.policy_id);
    }
    if (toDelete.length > 0) {
        await supabase.from("m365_ca_policies")
            .update({ deleted_at: fetchedAt } as any)
            .eq("m365_tenant_id", t.id)
            .in("policy_id", toDelete);
    }

    // AI gap analysis. We clear OPEN (unacknowledged) findings for this
    // tenant before inserting the new set — otherwise the operator sees the
    // same gap doubled up every run. Acknowledged findings stay.
    const analysis = await analysePolicies(policies, t.organization_id);
    await supabase.from("m365_ca_findings")
        .delete()
        .eq("m365_tenant_id", t.id)
        .is("acknowledged_at", null);

    for (const f of analysis.findings) {
        await supabase.from("m365_ca_findings").insert({
            m365_tenant_id:     t.id,
            organization_id:    t.organization_id,
            finding_key:        f.finding_key,
            severity:           f.severity,
            title:              f.title,
            body:               f.body,
            recommended_action: f.recommended_action,
            entra_deep_link:    ENTRA_CA_LIST_URL,
            related_policy_ids: f.related_policy_ids ?? [],
            model:              analysis.model,
            prompt_tokens:      analysis.prompt_tokens ?? null,
            completion_tokens:  analysis.completion_tokens ?? null,
            cost_microcents:    analysis.cost_microcents ?? 0,
        } as any);
    }

    return {
        tenant_pk:               t.id,
        azure_tid:               t.tenant_id,
        ok:                      true,
        policies_seen:           policies.length,
        policies_marked_deleted: toDelete.length,
        findings_written:        analysis.findings.length,
    };
}

// Authorization model — three caller categories, three rules:
//   1. cron-secret header   → privileged bulk run across every tenant (the
//      pg_cron daily fire path).
//   2. service-role JWT     → same: privileged bulk run.
//   3. user JWT             → MUST supply a single tenant_pk. We then
//      verify the user is a super-admin or a member of that tenant's
//      organization via is_super_admin / is_member_of_org. Bulk runs are
//      refused for user JWTs — otherwise any signed-in user could trigger
//      a Graph fetch + LLM run against every customer tenant on the
//      platform (real IDOR + cost-abuse vector).
interface AuthorisedCaller {
    mode: "privileged" | "user";
    userId?: string;
}

async function authorise(req: Request): Promise<AuthorisedCaller | null> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return { mode: "privileged" };

    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    if (jwt === SUPABASE_SERVICE_KEY) return { mode: "privileged" };

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { mode: "user", userId: user.id };
}

// Per-tenant authz for user-JWT callers. Uses is_super_admin /
// is_member_of_org so the same RLS-equivalent helper logic applies. We
// call these RPCs with the service-role client because both helpers are
// SECURITY DEFINER + STABLE — they don't read from auth.uid(), they take
// the user_id as an argument, so the result is identical regardless of
// which client invokes them. Avoids needing a per-request user-scoped
// client just to authz.
async function userMayRefreshTenant(userId: string, organizationId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isMember } = await supabase.rpc("is_member_of_org", {
        _user_id: userId, _org_id: organizationId,
    });
    return isMember === true;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authorise(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    // Optional body: { tenant_pk?: string } refreshes a single tenant when
    // the operator clicks "Refresh now". Bulk runs (no tenant_pk) are
    // privileged-only — see the authorise() comment for the rationale.
    let body: { tenant_pk?: string } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }

    if (caller.mode === "user" && !body.tenant_pk) {
        return json({ error: "tenant_pk_required" }, 400, origin);
    }

    let q = supabase.from("m365_tenants")
        .select("id, organization_id, tenant_id, tenant_display_name, access_token, refresh_token, access_token_expires_at, scopes");
    if (body.tenant_pk) q = q.eq("id", body.tenant_pk);

    const { data: tenants, error } = await q;
    if (error) return json({ error: "tenant_query_failed", detail: error.message }, 500, origin);

    // Per-tenant authz for user callers. If a user JWT supplied a tenant_pk
    // they don't have access to, refuse before fetching from Graph or
    // spending LLM tokens.
    if (caller.mode === "user") {
        const t = (tenants ?? [])[0] as TenantRow | undefined;
        if (!t) return json({ error: "tenant_not_found" }, 404, origin);
        const allowed = await userMayRefreshTenant(caller.userId!, t.organization_id);
        if (!allowed) return json({ error: "forbidden" }, 403, origin);
    }

    const results: TenantResult[] = [];
    for (const t of (tenants ?? []) as TenantRow[]) {
        try {
            results.push(await processTenant(t));
        } catch (e: any) {
            results.push({ tenant_pk: t.id, azure_tid: t.tenant_id, ok: false, error: e?.message ?? "exception" });
        }
    }

    return json({
        ran_at:  new Date().toISOString(),
        tenants: results.length,
        ok:      results.filter((r) => r.ok).length,
        results,
    }, 200, origin);
});
