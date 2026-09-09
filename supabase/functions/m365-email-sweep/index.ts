// =============================================================================
// /functions/v1/m365-email-sweep
//
// Cron-driven (every 5 minutes). For every M365-connected customer tenant:
//   1. List mailboxes (users with mail attribute).
//   2. For each mailbox, fetch messages received since the last watermark.
//   3. Score each message with an AI classifier (phishing / BEC / spam /
//      malware / suspicious / legitimate).
//   4. Insert any non-legitimate detections into email_threats. The DB
//      trigger fans medium+ severity events into event_outbox so any
//      configured SIEM destination picks them up.
//
// Auth: service-role JWT, called by the pg_cron kick function.
//
// Caveats:
//   - Read-only. We do not move messages today; quarantine action is
//     Phase 2.
//   - We never store the body. AI sees subject + from + a 2KB excerpt
//     of body; we persist only the verdict + reasoning + IOCs.
//   - We rate-limit per sweep: max MAX_MAILBOXES_PER_RUN mailboxes, max
//     MAX_MSGS_PER_MAILBOX messages per mailbox. New mailboxes catch up
//     across multiple sweeps.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLlmStructured } from "../_shared/ai-llm.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_TENANTS_PER_RUN   = 25;
const MAX_MAILBOXES_PER_RUN = 200;
// Per-cycle quota per mailbox. Small because the sweep runs every 5 minutes;
// the next cycle catches up. Larger values pushed past the worker wall-clock
// budget on tenants with many mailboxes.
const MAX_MSGS_PER_MAILBOX  = 10;
const MSG_BODY_EXCERPT_CHARS = 2000;
// Hard wall-clock budget the sweep voluntarily caps itself at, well inside
// the Edge Runtime supervisor's kill timeout. When exceeded the loop exits
// cleanly, persisting partial sweep state, and the next 5-minute tick
// continues from where this one stopped.
const SWEEP_BUDGET_MS       = 45_000;
// Parallel LLM classifications within a single mailbox. 5 concurrent calls
// is well inside OpenAI tier 1 rate limits and the only knob that lets a
// busy mailbox finish within budget.
const CLASSIFY_CONCURRENCY  = 5;
// First-time watermark floor. When a mailbox is swept for the first time
// (no email_sweep_runs row yet), the sweep would otherwise walk forward
// from the OLDEST message in the inbox — burning weeks of tokens scanning
// ancient mail. Anchor the watermark to (now - this many hours) so the
// initial sweep covers a small "currently in flight" window only.
const INITIAL_LOOKBACK_HOURS = 24;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

interface GraphUser {
    id: string;
    userPrincipalName?: string;
    mail?: string;
    displayName?: string;
}

interface GraphMessage {
    id: string;
    // RFC 5322 Message-ID. Same value across every recipient mailbox that
    // received this send — the campaign-grouping key for cross-mailbox sweep.
    internetMessageId?: string;
    receivedDateTime: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    sender?: { emailAddress?: { name?: string; address?: string } };
    internetMessageHeaders?: Array<{ name: string; value: string }>;
    bodyPreview?: string;
    body?: { contentType: string; content: string };
    hasAttachments?: boolean;
    webLink?: string;
}

interface ClassificationOutput {
    classification: "phishing" | "bec" | "spam" | "malware" | "suspicious" | "legitimate";
    confidence: number;
    severity: "low" | "medium" | "high" | "critical";
    reasoning: string;
    iocs: Record<string, unknown>;
}

// OpenAI strict response_format requires additionalProperties:false at EVERY
// object level and every property to be listed in `required`. Optional
// values are expressed with a nullable union type rather than being absent.
// The classifier was silently 400'ing on every call until this was fixed.
const CLASSIFICATION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        classification: { type: "string", enum: ["phishing", "bec", "spam", "malware", "suspicious", "legitimate"] },
        confidence:     { type: "integer", minimum: 0, maximum: 100 },
        severity:       { type: "string", enum: ["low", "medium", "high", "critical"] },
        reasoning:      { type: "string", maxLength: 1000 },
        iocs: {
            type: "object",
            additionalProperties: false,
            properties: {
                suspicious_links:     { type: "array", items: { type: "string" } },
                suspicious_domains:   { type: "array", items: { type: "string" } },
                impersonation_target: { type: ["string", "null"] },
                attachment_names:     { type: "array", items: { type: "string" } },
                spoofing_indicators:  { type: "array", items: { type: "string" } },
            },
            required: ["suspicious_links", "suspicious_domains", "impersonation_target", "attachment_names", "spoofing_indicators"],
        },
    },
    required: ["classification", "confidence", "severity", "reasoning", "iocs"],
};

const SYSTEM_PROMPT = `You are an expert email security analyst classifying corporate inbox messages.
You see ONE message at a time: subject, sender, key headers, and a body excerpt.
Decide whether it is phishing, BEC (business email compromise), spam, malware delivery, suspicious, or legitimate.

Rules:
- Cite specific evidence in the reasoning (sender domain mismatch, lookalike domains, urgent payment / wire requests from execs, suspicious links, HTML-form login lures, attachment names).
- BEC = financial fraud impersonating an exec / vendor / partner. Phishing = credential theft via links. Malware = attachment or link delivering payload. Spam = unsolicited but non-malicious commercial. Suspicious = uncertain but worth review.
- Severity scales with potential blast radius and confidence: critical (active BEC / ransomware delivery), high (credential theft attempt), medium (spam with suspicious links, low-skill phishing), low (commercial spam, newsletters with poor hygiene).
- Default to legitimate when the message is benign internal mail, expected vendor mail, or a clear newsletter.
- iocs.suspicious_domains should be the bare domain (no scheme). suspicious_links can be full URLs.`;

function userPromptForMessage(msg: GraphMessage, recipientEmail: string): string {
    const headers: Record<string, string> = {};
    for (const h of (msg.internetMessageHeaders ?? [])) {
        const lower = h.name.toLowerCase();
        if (["from", "to", "subject", "return-path", "reply-to", "authentication-results", "received-spf", "dkim-signature", "x-mailer"].includes(lower)) {
            headers[lower] = h.value.slice(0, 600);
        }
    }
    const body = (msg.body?.content ?? msg.bodyPreview ?? "").slice(0, MSG_BODY_EXCERPT_CHARS);
    const stripped = msg.body?.contentType === "html"
        ? body.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : body;
    return `Recipient: ${recipientEmail}
Subject: ${msg.subject ?? "(no subject)"}
From: ${msg.from?.emailAddress?.address ?? "(unknown)"} (${msg.from?.emailAddress?.name ?? ""})
Has attachments: ${msg.hasAttachments ? "yes" : "no"}
Headers:
${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)"}

Body excerpt:
${stripped || "(empty body)"}`;
}

function domainFromEmail(addr: string | undefined | null): string | null {
    if (!addr) return null;
    const m = addr.match(/@([^>\s]+)/);
    return m ? m[1].toLowerCase() : null;
}

// ----------------------------------------------------------------------------
// Block-rule matching. Loaded once per tenant per sweep; rules are small (a
// few dozen per org at most) so we just evaluate them in-memory per message.
// ----------------------------------------------------------------------------
interface BlockRule {
    id: string;
    organization_id: string;
    kind: "sender_email" | "sender_domain" | "subject_regex";
    value: string;
    action: "quarantine" | "warn" | "drop";
    reason: string | null;
}

async function loadBlockRules(orgId: string): Promise<BlockRule[]> {
    const { data } = await supabase
        .from("email_block_rules")
        .select("id, organization_id, kind, value, action, reason")
        .eq("organization_id", orgId)
        .eq("enabled", true);
    return (data ?? []) as BlockRule[];
}

function matchBlockRule(
    rules: BlockRule[],
    senderEmail: string | null,
    senderDomain: string | null,
    subject: string,
): BlockRule | null {
    if (rules.length === 0) return null;
    const sLower = (senderEmail ?? "").toLowerCase();
    const dLower = (senderDomain ?? "").toLowerCase();
    for (const r of rules) {
        if (r.kind === "sender_email" && sLower && r.value === sLower) return r;
        if (r.kind === "sender_domain" && dLower) {
            // Exact match OR right-anchored subdomain match (rule "evilcorp.com" matches "mail.evilcorp.com").
            if (dLower === r.value || dLower.endsWith("." + r.value)) return r;
        }
        if (r.kind === "subject_regex") {
            try {
                const re = new RegExp(r.value, "i");
                if (re.test(subject)) return r;
            } catch { /* invalid regex — ignore */ }
        }
    }
    return null;
}

function classificationFromRule(rule: BlockRule): { classification: ClassificationOutput["classification"]; severity: ClassificationOutput["severity"]; confidence: number } {
    // The rule action drives severity for downstream alerting. A 'quarantine'
    // rule is "we know this is bad" (treat as phishing/medium), 'warn' is high
    // intent (likely impersonation, high severity), 'drop' is known-spam.
    if (rule.action === "drop") return { classification: "spam",     severity: "low",    confidence: 100 };
    if (rule.action === "warn") return { classification: "phishing", severity: "high",   confidence: 100 };
    return                        { classification: "phishing", severity: "medium", confidence: 100 };
}

async function classifyMessage(msg: GraphMessage, recipientEmail: string, orgId: string): Promise<ClassificationOutput | null> {
    const res = await callLlmStructured<ClassificationOutput>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt:   userPromptForMessage(msg, recipientEmail),
        schema:       CLASSIFICATION_SCHEMA,
        schemaName:   "email_classification",
        feature:      "email_security",
        organizationId: orgId,
        timeoutMs:    30000,
    });
    if (!res.ok) {
        console.error("email classify llm error:", res.error);
        return null;
    }
    return res.data;
}

// ----------------------------------------------------------------------------
// Graph: resolve a well-known folder id and move a message into it. Used by
// block-rule auto-quarantine inside the sweep itself.
// ----------------------------------------------------------------------------
const folderIdCache = new Map<string, string>();   // key: `${userId}|${name}`

async function findFolderId(token: string, userId: string, displayName: string): Promise<string | null> {
    const key = `${userId}|${displayName.toLowerCase()}`;
    if (folderIdCache.has(key)) return folderIdCache.get(key)!;
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders?$select=id,displayName&$top=50`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const found = (json.value as Array<{ id: string; displayName: string }>).find(f => f.displayName?.toLowerCase() === displayName.toLowerCase());
    if (found?.id) { folderIdCache.set(key, found.id); return found.id; }
    return null;
}

async function moveMessageToJunk(token: string, userId: string, messageId: string): Promise<{ ok: true; folderId: string } | { ok: false; error: string }> {
    const folderId = await findFolderId(token, userId, "Junk Email");
    if (!folderId) return { ok: false, error: "folder_not_found:Junk Email" };
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/move`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ destinationId: folderId }),
    });
    if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, 200);
        return { ok: false, error: `graph_${resp.status}:${text}` };
    }
    return { ok: true, folderId };
}

async function fetchTenants(): Promise<TenantRow[]> {
    // m365-oauth-callback writes consent_state='active' on success. The rest
    // of the M365 stack (ITDR poll, posture, settings UI) filters on 'active'.
    // Earlier this function queried 'granted' and silently swept zero tenants.
    const { data } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, tenant_display_name, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("consent_state", "active")
        .limit(MAX_TENANTS_PER_RUN);
    const tenants = (data ?? []) as TenantRow[];

    // Order tenants by oldest sweep first so a budget-bound run never
    // starves a tenant that's already behind. NULL "most recent sweep"
    // (i.e. never swept) sorts first.
    if (tenants.length > 1) {
        const { data: recencyRows } = await supabase
            .from("email_sweep_runs")
            .select("m365_tenant_id, last_swept_at")
            .in("m365_tenant_id", tenants.map(t => t.id));
        const lastByTenant = new Map<string, string>();
        for (const r of (recencyRows ?? []) as Array<{ m365_tenant_id: string; last_swept_at: string }>) {
            const prev = lastByTenant.get(r.m365_tenant_id);
            if (!prev || r.last_swept_at > prev) lastByTenant.set(r.m365_tenant_id, r.last_swept_at);
        }
        tenants.sort((a, b) => {
            const av = lastByTenant.get(a.id);
            const bv = lastByTenant.get(b.id);
            if (av === undefined && bv === undefined) return 0;
            if (av === undefined) return -1; // never swept → top
            if (bv === undefined) return 1;
            return av < bv ? -1 : av > bv ? 1 : 0;
        });
    }
    return tenants;
}

async function fetchMailboxes(token: string): Promise<GraphUser[]> {
    // Graph's /users endpoint rejects `$filter=mail ne null` with 400
    // Request_UnsupportedQuery unless we also opt into the advanced query
    // surface (ConsistencyLevel: eventual + $count=true). Easier to drop
    // the filter entirely and exclude null-mail users client-side — Graph's
    // /users is paged at 200 by default which is well inside our budget for
    // a typical SMB tenant.
    const url = "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,mail,displayName&$top=200";
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
        console.error("graph users fetch failed:", resp.status, (await resp.text().catch(() => "")).slice(0, 200));
        return [];
    }
    const json = await resp.json();
    const all = (json.value ?? []) as GraphUser[];
    return all.filter(u => !!u.mail);
}

async function fetchNewMessages(token: string, userId: string, since: string | null): Promise<GraphMessage[]> {
    const filter = since
        ? `&$filter=receivedDateTime gt ${since}`
        : "";
    // We fetch from the Inbox folder only — Sent/Drafts/Junk don't need classification.
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders/Inbox/messages?$top=${MAX_MSGS_PER_MAILBOX}&$orderby=receivedDateTime asc&$select=id,internetMessageId,receivedDateTime,subject,from,sender,internetMessageHeaders,bodyPreview,body,hasAttachments,webLink${filter}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Prefer": 'outlook.body-content-type="text"' } });
    if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, 200);
        console.error(`graph messages fetch failed for ${userId}: ${resp.status} ${text}`);
        return [];
    }
    const json = await resp.json();
    return (json.value ?? []) as GraphMessage[];
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) ?? null;
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

    // The token's scope set must include everything we'll need this run,
    // including the brand-new Mail.Read scope. We request the same
    // baseline + remediation set used by m365-poll-tenants.
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

async function processTenant(t: TenantRow, stats: { scanned: number; detected: number; errors: number; mailboxes: number; budgetExceeded?: boolean }, runStart: number): Promise<void> {
    let accessToken: string;
    try {
        accessToken = await ensureFreshToken(t);
    } catch (e: any) {
        stats.errors++;
        console.error(`tenant ${t.tenant_id} token refresh failed:`, e?.message);
        return;
    }

    if (!(t.scopes ?? []).includes("Mail.Read")) {
        console.log(`tenant ${t.tenant_id} missing Mail.Read scope, skipping`);
        return;
    }

    const mailboxes = await fetchMailboxes(accessToken);
    const blockRules = await loadBlockRules(t.organization_id);
    // v0.7.6: AI auto-quarantine is gated by BOTH the Graph scope (technical
    // ability) AND the per-org master switch (customer policy). Either off →
    // no auto-action; the message still gets flagged + classified for the
    // operator to action manually.
    const { data: orgRow } = await supabase
        .from("organizations")
        .select("ai_email_remediation_enabled")
        .eq("id", t.organization_id)
        .maybeSingle();
    const orgPermitsAutoRemediation = (orgRow as { ai_email_remediation_enabled?: boolean } | null)?.ai_email_remediation_enabled === true;
    const canRemediate = (t.scopes ?? []).includes("Mail.ReadWrite") && orgPermitsAutoRemediation;
    let mailboxesProcessed = 0;

    // Per-tenant counters fed into email_sweep_metrics at end of this pass.
    // Scoped to this tenant so a poll that touches N tenants writes N rows.
    let tenantScanned        = 0;
    let tenantClassifiedByAi = 0;
    let tenantMatchedByRule  = 0;
    let tenantThreatsDetected = 0;
    let tenantMailboxesSwept = 0;
    for (const user of mailboxes) {
        if (Date.now() - runStart > SWEEP_BUDGET_MS) {
            stats.budgetExceeded = true;
            console.log(`tenant ${t.tenant_id}: wall-clock budget hit at mailbox ${mailboxesProcessed}, deferring to next cycle`);
            break;
        }
        if (stats.mailboxes >= MAX_MAILBOXES_PER_RUN) break;
        stats.mailboxes++; mailboxesProcessed++;

        // Watermark
        const { data: sweepRow } = await supabase
            .from("email_sweep_runs")
            .select("last_message_received_at")
            .eq("m365_tenant_id", t.id)
            .eq("recipient_user_id", user.id)
            .maybeSingle();
        // First-time watermark: anchor to (now - INITIAL_LOOKBACK_HOURS) so a
        // freshly-connected mailbox is not walked from epoch. After this, the
        // upsert below always persists `last_message_received_at`, so the
        // watermark is monotonic and historical mail is never re-scanned.
        const initialFloor = new Date(Date.now() - INITIAL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
        const since = sweepRow?.last_message_received_at ?? initialFloor;

        const messages = await fetchNewMessages(accessToken, user.id, since);
        if (messages.length === 0) {
            // Persist the floor even on an empty mailbox so a subsequent
            // sweep doesn't replay the lookback window from null.
            await supabase.from("email_sweep_runs").upsert({
                organization_id: t.organization_id,
                m365_tenant_id:  t.id,
                recipient_user_id: user.id,
                recipient_email: user.mail ?? user.userPrincipalName ?? null,
                last_message_received_at: since,
                last_swept_at:   new Date().toISOString(),
                last_error:      null,
            } as any, { onConflict: "m365_tenant_id,recipient_user_id" });
            continue;
        }

        let detected = 0;
        let latestReceived: string | null = since;
        const recipient = user.mail ?? user.userPrincipalName ?? "";
        tenantMailboxesSwept++;

        // First pass: separate block-rule hits (no LLM needed) from LLM
        // candidates. Block rules are deterministic so we apply them
        // sequentially. LLM classifications then fan out in parallel.
        const llmCandidates: GraphMessage[] = [];
        for (const msg of messages) {
            stats.scanned++;
            tenantScanned++;
            const senderEmail = msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null;
            const senderDomain = domainFromEmail(senderEmail ?? undefined);
            const subject = (msg.subject ?? "");
            const headers = (msg.internetMessageHeaders ?? []).slice(0, 20).reduce((acc, h) => ({ ...acc, [h.name.toLowerCase()]: h.value.slice(0, 600) }), {} as Record<string, string>);

            // 1. Block-rule short-circuit: skip the LLM entirely.
            const rule = matchBlockRule(blockRules, senderEmail, senderDomain, subject);
            if (rule) {
                detected++;
                stats.detected++;
                tenantMatchedByRule++;
                tenantThreatsDetected++;
                const synth = classificationFromRule(rule);
                let actionTaken: "flagged" | "quarantined" | "user_warned" = "flagged";
                let quarantineFolderId: string | null = null;

                if ((rule.action === "quarantine" || rule.action === "warn") && canRemediate) {
                    const moved = await moveMessageToJunk(accessToken, user.id, msg.id);
                    if (moved.ok) {
                        actionTaken = "quarantined";
                        quarantineFolderId = moved.folderId;
                    } else {
                        console.error(`block-rule quarantine move failed for ${user.id}: ${moved.error}`);
                    }
                }

                await supabase.from("email_threats").upsert({
                    organization_id:     t.organization_id,
                    m365_tenant_id:      t.id,
                    graph_message_id:    msg.id,
                    internet_message_id: msg.internetMessageId ?? null,
                    recipient_user_id:   user.id,
                    recipient_email:     recipient,
                    sender_email:        senderEmail,
                    sender_domain:       senderDomain,
                    sender_display_name: msg.from?.emailAddress?.name ?? null,
                    subject:             subject.slice(0, 500),
                    received_at:         msg.receivedDateTime,
                    classification:      synth.classification,
                    confidence:          synth.confidence,
                    severity:            synth.severity,
                    ai_reasoning:        `Matched block rule (${rule.kind}: ${rule.value})${rule.reason ? ` — ${rule.reason}` : ""}`,
                    iocs:                { matched_rule_id: rule.id, matched_rule_kind: rule.kind, matched_rule_value: rule.value, matched_rule_action: rule.action },
                    headers,
                    action_taken:        actionTaken,
                    matched_rule_id:     rule.id,
                    quarantine_folder_id: quarantineFolderId,
                } as any, { onConflict: "m365_tenant_id,graph_message_id,recipient_user_id" });

                await supabase.rpc("increment_email_block_rule_hit", { _rule_id: rule.id } as any);

                if (!latestReceived || msg.receivedDateTime > latestReceived) latestReceived = msg.receivedDateTime;
                continue;
            }

            // 2. Not block-matched → queue for the LLM batch (parallel below).
            llmCandidates.push(msg);
        }

        // Fan out LLM classifications in bounded-concurrency batches. This is
        // the only knob that lets a busy mailbox complete inside the worker's
        // wall-clock budget. Within each batch we await Promise.all; between
        // batches we check the budget so a single mailbox can't starve the
        // others.
        for (let i = 0; i < llmCandidates.length; i += CLASSIFY_CONCURRENCY) {
            if (Date.now() - runStart > SWEEP_BUDGET_MS) { stats.budgetExceeded = true; break; }
            const batch = llmCandidates.slice(i, i + CLASSIFY_CONCURRENCY);
            tenantClassifiedByAi += batch.length;
            const verdicts = await Promise.all(batch.map(m => classifyMessage(m, recipient, t.organization_id)));
            for (let j = 0; j < batch.length; j++) {
                const msg = batch[j];
                const cls = verdicts[j];
                if (!latestReceived || msg.receivedDateTime > latestReceived) latestReceived = msg.receivedDateTime;
                if (!cls || cls.classification === "legitimate") continue;

                detected++;
                stats.detected++;
                tenantThreatsDetected++;
                const senderEmail = msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null;
                const senderDomain = domainFromEmail(senderEmail ?? undefined);
                const subject = (msg.subject ?? "");
                const headers = (msg.internetMessageHeaders ?? []).slice(0, 20).reduce((acc, h) => ({ ...acc, [h.name.toLowerCase()]: h.value.slice(0, 600) }), {} as Record<string, string>);
                await supabase.from("email_threats").upsert({
                    organization_id:     t.organization_id,
                    m365_tenant_id:      t.id,
                    graph_message_id:    msg.id,
                    internet_message_id: msg.internetMessageId ?? null,
                    recipient_user_id:   user.id,
                    recipient_email:     recipient,
                    sender_email:        senderEmail,
                    sender_domain:       senderDomain,
                    sender_display_name: msg.from?.emailAddress?.name ?? null,
                    subject:             subject.slice(0, 500),
                    received_at:         msg.receivedDateTime,
                    classification:      cls.classification,
                    confidence:          cls.confidence,
                    severity:            cls.severity,
                    ai_reasoning:        cls.reasoning,
                    iocs:                cls.iocs,
                    headers,
                    action_taken:        "flagged",
                } as any, { onConflict: "m365_tenant_id,graph_message_id,recipient_user_id" });
            }
        }

        await supabase.from("email_sweep_runs").upsert({
            organization_id: t.organization_id,
            m365_tenant_id:  t.id,
            recipient_user_id: user.id,
            recipient_email: recipient,
            last_message_received_at: latestReceived,
            messages_scanned: (sweepRow ? 0 : 0) + messages.length,
            threats_detected: detected,
            last_swept_at:    new Date().toISOString(),
            last_error:       null,
        } as any, { onConflict: "m365_tenant_id,recipient_user_id" });
    }

    await supabase.from("m365_tenants").update({ last_poll_at: new Date().toISOString() } as any).eq("id", t.id);

    // Flush per-tenant counters to the daily metrics table. Used by the
    // console to render "Messages scanned (30d)" and similar confidence
    // numbers. Skip the call if nothing happened this pass.
    if (tenantScanned > 0 || tenantMailboxesSwept > 0) {
        const { error: metricsErr } = await supabase.rpc("increment_email_sweep_metrics", {
            _organization_id:           t.organization_id,
            _messages_scanned:          tenantScanned,
            _messages_classified_by_ai: tenantClassifiedByAi,
            _messages_matched_by_rule:  tenantMatchedByRule,
            _threats_detected:          tenantThreatsDetected,
            _mailboxes_swept:           tenantMailboxesSwept,
        } as any);
        if (metricsErr) console.error(`email_sweep_metrics increment failed for tenant ${t.tenant_id}: ${metricsErr.message}`);
    }
}

// v0.7.6: lock TTL covers the worst-case run length comfortably. The
// per-run budget is 45s; we ask for 120s so a stalled Graph/LLM call
// doesn't immediately permit a second run on top — but a crashed
// invocation can't wedge the mutex for more than 2 minutes.
const SWEEP_LOCK_NAME    = "m365-email-sweep";
const SWEEP_LOCK_TTL_SEC = 120;

Deno.serve(async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    const tok = auth.replace(/^Bearer\s+/i, "").trim();
    if (tok !== SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    const stats: { scanned: number; detected: number; errors: number; mailboxes: number; tenants: number; budgetExceeded?: boolean; lockHeld?: boolean } =
        { scanned: 0, detected: 0, errors: 0, mailboxes: 0, tenants: 0 };
    const runStart = Date.now();

    // Mutex: at 2-minute cadence with a 45s budget two ticks should never
    // overlap, but a slow Graph response can push past the budget. Without
    // this, the next tick would race the same `since` watermark and pay
    // for duplicate LLM classifications on the in-flight mailbox. Returns
    // 200 with lockHeld=true so the cron caller doesn't treat it as an
    // error worth retrying.
    const { data: gotLock, error: lockErr } = await supabase.rpc("try_acquire_platform_lock", {
        _name: SWEEP_LOCK_NAME,
        _ttl_seconds: SWEEP_LOCK_TTL_SEC,
        _holder: `m365-email-sweep@${new Date().toISOString()}`,
    });
    if (lockErr) {
        console.error("lock acquire failed", lockErr);
        return new Response(JSON.stringify({ ok: false, error: "lock_acquire_failed" }), { status: 500, headers: { "content-type": "application/json" } });
    }
    if (gotLock === false) {
        stats.lockHeld = true;
        return new Response(JSON.stringify({ ok: true, skipped: "another sweep is in progress", ...stats }), { status: 200, headers: { "content-type": "application/json" } });
    }

    try {
        const tenants = await fetchTenants();
        stats.tenants = tenants.length;
        for (const t of tenants) {
            if (stats.mailboxes >= MAX_MAILBOXES_PER_RUN) break;
            if (Date.now() - runStart > SWEEP_BUDGET_MS) {
                stats.budgetExceeded = true;
                console.log(`run budget hit before tenant ${t.tenant_id}, deferring to next cycle`);
                break;
            }
            await processTenant(t, stats, runStart);
        }
        return new Response(JSON.stringify({ ok: true, ...stats }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: e?.message ?? "sweep_failed", ...stats }), { status: 500, headers: { "content-type": "application/json" } });
    } finally {
        // Release the lock on the happy path AND every error path. If the
        // worker SIGKILLs before this runs (rare), the TTL backstop in the
        // RPC will release the lock on the next acquire attempt.
        try {
            await supabase.rpc("release_platform_lock", { _name: SWEEP_LOCK_NAME });
        } catch (e) {
            console.error("lock release failed (TTL will recover)", e);
        }
    }
});
