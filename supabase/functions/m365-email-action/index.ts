// =============================================================================
// /functions/v1/m365-email-action
//
// Operator-initiated actions on flagged email_threats rows.
//
//   POST { threat_id, action }                          — single-row action
//   POST { threat_ids: [...], action }                  — bulk action
//
//   action ∈ { "quarantine", "warn", "release" }
//
// Auth: caller must be authenticated via Supabase JWT AND be a super-admin,
// org-admin, or partner-admin over each threat's organization. RLS via a
// user-scoped client gates the SELECT; the explicit RPC check gates the write.
//
// Response shape (always — single and bulk):
//   { results: [{ threat_id, ok, action?, error? }, ...],
//     summary: { total, ok, failed } }
//
// Side-effect logging: each successful action writes action_taken +
// action_taken_by + action_taken_at on the row. The console UI re-renders from
// that state.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";
import { sendSimpleMail } from "../_shared/smtp-send.ts";
import { escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";

const BULK_LIMIT = 200;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// ------------------------------------------------------------
// Per-tenant token refresh (same pattern as m365-email-sweep)
// ------------------------------------------------------------
async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) ?? null;
}

interface TenantRow {
    id: string; tenant_id: string;
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

    const scopes = (t.scopes && t.scopes.length > 0) ? t.scopes : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];
    const tok = await refreshAccessToken({ authority, tenantId: t.tenant_id, clientId, clientSecret, refreshToken: t.refresh_token, scopes });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = { access_token: tok.access_token, access_token_expires_at: newExpiresAt };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) patch.refresh_token = tok.refresh_token;
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    // Mutate the cached row so subsequent calls in the same batch reuse the new token.
    t.access_token = tok.access_token;
    t.access_token_expires_at = newExpiresAt;
    if (tok.refresh_token) t.refresh_token = tok.refresh_token;
    return tok.access_token;
}

// ------------------------------------------------------------
// Graph: find a well-known folder id for the mailbox
// ------------------------------------------------------------
async function findFolderId(token: string, userId: string, displayName: string): Promise<string | null> {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders?$select=id,displayName&$top=50`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const found = (json.value as Array<{ id: string; displayName: string }>).find(f => f.displayName?.toLowerCase() === displayName.toLowerCase());
    return found?.id ?? null;
}

async function moveMessage(token: string, userId: string, messageId: string, destinationFolderName: string): Promise<{ ok: true; newFolderId: string } | { ok: false; error: string }> {
    const folderId = await findFolderId(token, userId, destinationFolderName);
    if (!folderId) return { ok: false, error: `folder_not_found:${destinationFolderName}` };

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/move`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ destinationId: folderId }),
    });
    if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, 300);
        return { ok: false, error: `graph_${resp.status}:${text}` };
    }
    return { ok: true, newFolderId: folderId };
}

// ------------------------------------------------------------
// Warning email body (sent to the recipient)
// ------------------------------------------------------------
function warningEmail(threat: any, releaseUrl: string): { subject: string; html: string; text: string } {
    const subject = `Mithras flagged a suspicious email in your inbox`;
    const reasoning = threat.ai_reasoning ?? "";
    const senderLine = `${threat.sender_email ?? "unknown sender"}`;
    const originalSubject = threat.subject ?? "(no subject)";

    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7fb;margin:0;padding:24px;color:#111">
<div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <div style="background:#dc2626;color:#fff;padding:16px 20px;font-weight:600">Suspicious email detected</div>
  <div style="padding:20px;font-size:14px;line-height:1.5">
    <p>Mithras classified an email in your inbox as <strong>${escapeHtml(threat.classification)}</strong> and moved it to your <strong>Junk Email</strong> folder.</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px">
      <tr><td style="padding:4px 8px;color:#6b7280;width:90px">From</td><td style="padding:4px 8px">${escapeHtml(senderLine)}</td></tr>
      <tr><td style="padding:4px 8px;color:#6b7280">Subject</td><td style="padding:4px 8px">${escapeHtml(originalSubject)}</td></tr>
      <tr><td style="padding:4px 8px;color:#6b7280">Reason</td><td style="padding:4px 8px">${escapeHtml(reasoning)}</td></tr>
    </table>
    <p>If this was a real message you were expecting, you can release it back to your Inbox using the button below. Otherwise leave it where it is.</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${releaseUrl}" style="background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Release to my Inbox</a>
    </p>
    <p style="font-size:12px;color:#6b7280">If you didn't expect this email, do nothing. The link is valid for 14 days.</p>
  </div>
  <div style="background:#f9fafb;padding:12px 20px;font-size:11px;color:#6b7280">Sent by Mithras Threat Defence on behalf of your IT team.</div>
</div></body></html>`;

    const text = `Mithras flagged a suspicious email in your inbox.
Classification: ${threat.classification}
From: ${senderLine}
Subject: ${originalSubject}
Reason: ${reasoning}

If this was a real message you were expecting, release it from Junk back to your Inbox: ${releaseUrl}
Link valid for 14 days.`;

    return { subject, html, text };
}

// ------------------------------------------------------------
// Cross-mailbox sweep on quarantine.
//
// When the operator (or AI) quarantines a single threat, every other
// mailbox in the same M365 tenant that received the SAME inbound send
// (matched by internetMessageId, the RFC 5322 Message-ID) needs the same
// treatment. Without this, a campaign blasted to 50 inboxes leaves 49
// copies sitting in users' Inboxes.
//
// Approach:
//   1. Look up sibling email_threats rows by (m365_tenant_id, internet_message_id).
//   2. Filter out the origin itself and rows already quarantined or released.
//   3. For each sibling, move via Graph + stamp it with parent_threat_id +
//      action_taken=quarantined + campaign_swept_at.
//   4. Stamp the origin with campaign_swept_at so the UI can group.
//
// Returns the number of siblings successfully swept (does NOT throw on
// per-sibling failure — partial success is reported via the
// `campaign_partial_failures` field on the action response).
// ------------------------------------------------------------
async function crossSweepCampaign(
    originThreat: {
        id: string;
        organization_id: string;
        m365_tenant_id: string;
        internet_message_id: string | null;
        graph_message_id: string;
    },
    tenant: TenantRow,
    actingUserId: string,
): Promise<{ swept: number; failed: number; sibling_count: number }> {
    if (!originThreat.internet_message_id) {
        // No Message-ID captured — can't group. Sweep returns no-op.
        return { swept: 0, failed: 0, sibling_count: 0 };
    }
    // Service-role read bypasses RLS. We must enforce tenant boundaries
    // explicitly here: filter by organization_id AND m365_tenant_id. The
    // schema doesn't prevent two customer orgs from registering the same
    // Microsoft tenant id (subsidiaries, misconfig, future multi-mailbox
    // delegations) — without the organization_id filter, an admin in one
    // org could sweep mail belonging to another org sharing the tenant.
    const { data: siblings } = await supabase
        .from("email_threats")
        .select("id, recipient_user_id, graph_message_id, action_taken")
        .eq("organization_id", originThreat.organization_id)
        .eq("m365_tenant_id", originThreat.m365_tenant_id)
        .eq("internet_message_id", originThreat.internet_message_id)
        .neq("id", originThreat.id);

    const targets = (siblings ?? []).filter(s =>
        s.action_taken !== "quarantined" && s.action_taken !== "released"
    );
    if (targets.length === 0) {
        // Always stamp the origin so the UI knows the sweep ran (even with 0 siblings).
        await supabase.from("email_threats")
            .update({ campaign_swept_at: new Date().toISOString() } as any)
            .eq("id", originThreat.id);
        return { swept: 0, failed: 0, sibling_count: 0 };
    }

    // Token already valid — actOnThreat refreshed it just before.
    let token: string;
    try { token = await ensureFreshToken(tenant); } catch { return { swept: 0, failed: 0, sibling_count: targets.length }; }

    let swept = 0, failed = 0;
    const sweptAt = new Date().toISOString();

    for (const s of targets) {
        const res = await moveMessage(token, s.recipient_user_id ?? "", s.graph_message_id, "Junk Email");
        if (res.ok) {
            await supabase.from("email_threats").update({
                action_taken:          "quarantined",
                action_taken_at:       sweptAt,
                action_taken_by:       actingUserId,
                parent_threat_id:      originThreat.id,
                campaign_swept_at:     sweptAt,
                quarantine_folder_id:  res.newFolderId,
            } as any).eq("id", s.id);
            swept++;
        } else {
            console.error(`cross-sweep failed for sibling ${s.id}: ${res.error}`);
            failed++;
        }
    }

    // Stamp the origin (whether siblings succeeded or not — the campaign was attempted).
    await supabase.from("email_threats")
        .update({ campaign_swept_at: sweptAt } as any)
        .eq("id", originThreat.id);

    return { swept, failed, sibling_count: targets.length };
}

// ------------------------------------------------------------
// Per-threat action (called once per id, in a sequential loop)
// ------------------------------------------------------------
async function actOnThreat(
    userClient: ReturnType<typeof createClient>,
    userId: string,
    threatId: string,
    action: "quarantine" | "warn" | "release",
    tenantCache: Map<string, TenantRow>,
): Promise<{ ok: true; action: string; campaign?: { swept: number; failed: number; sibling_count: number } } | { ok: false; error: string }> {
    const { data: threat } = await userClient
        .from("email_threats")
        .select("id, organization_id, m365_tenant_id, graph_message_id, internet_message_id, recipient_user_id, recipient_email, sender_email, subject, classification, ai_reasoning, action_taken, release_token, quarantine_folder_id")
        .eq("id", threatId)
        .maybeSingle();
    if (!threat) return { ok: false, error: "threat_not_found_or_forbidden" };

    // Authz per row (orgs may differ across bulk selection).
    const [{ data: isAdmin }, { data: isPartnerAdmin }, { data: isSuper }] = await Promise.all([
        userClient.rpc("is_admin_of_org",          { _user_id: userId, _org_id: threat.organization_id } as any),
        userClient.rpc("is_partner_admin_of_org",  { _user_id: userId, _org_id: threat.organization_id } as any),
        userClient.rpc("is_super_admin",           { _user_id: userId } as any),
    ]);
    if (!isAdmin && !isPartnerAdmin && !isSuper) return { ok: false, error: "forbidden" };

    // Load (or reuse) the M365 tenant row.
    let tenant = tenantCache.get(threat.m365_tenant_id);
    if (!tenant) {
        const { data } = await supabase
            .from("m365_tenants")
            .select("id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
            .eq("id", threat.m365_tenant_id)
            .maybeSingle();
        if (!data) return { ok: false, error: "tenant_not_connected" };
        tenant = data as TenantRow;
        tenantCache.set(threat.m365_tenant_id, tenant);
    }

    if (action === "quarantine" || action === "release") {
        if (!(tenant.scopes ?? []).includes("Mail.ReadWrite")) {
            return { ok: false, error: "missing_scope_mail_readwrite" };
        }
        let token: string;
        try { token = await ensureFreshToken(tenant); } catch (e: any) { return { ok: false, error: e?.message ?? "token_refresh_failed" }; }
        const destination = action === "quarantine" ? "Junk Email" : "Inbox";
        const res = await moveMessage(token, threat.recipient_user_id ?? "", threat.graph_message_id, destination);
        if (!res.ok) return { ok: false, error: res.error };

        const patch: Record<string, unknown> = {
            action_taken: action === "quarantine" ? "quarantined" : "released",
            action_taken_at: new Date().toISOString(),
            action_taken_by: userId,
        };
        if (action === "quarantine") patch.quarantine_folder_id = res.newFolderId;
        if (action === "release")    patch.released_at          = new Date().toISOString();
        await supabase.from("email_threats").update(patch as any).eq("id", threat.id);

        // Cross-mailbox sweep ONLY on quarantine — never on release (that
        // would un-quarantine other users' mail without their consent).
        let campaign: { swept: number; failed: number; sibling_count: number } | undefined;
        if (action === "quarantine") {
            campaign = await crossSweepCampaign(
                {
                    id: threat.id,
                    organization_id: threat.organization_id,
                    m365_tenant_id: threat.m365_tenant_id,
                    internet_message_id: (threat as any).internet_message_id ?? null,
                    graph_message_id: threat.graph_message_id,
                },
                tenant,
                userId,
            );
        }
        return { ok: true, action: patch.action_taken as string, ...(campaign ? { campaign } : {}) };
    }

    // action === "warn"
    if (!threat.recipient_email) return { ok: false, error: "no_recipient_email" };
    const releaseUrl = `${SITE_URL}/email-release?token=${threat.release_token}`;
    const { subject, html, text } = warningEmail(threat, releaseUrl);
    try {
        await sendSimpleMail(supabase, { to: [threat.recipient_email], subject, htmlBody: html, textBody: text });
    } catch (e: any) {
        return { ok: false, error: `smtp_send_failed:${e?.message ?? "unknown"}` };
    }
    await supabase.from("email_threats").update({
        action_taken: "user_warned",
        action_taken_at: new Date().toISOString(),
        action_taken_by: userId,
        warning_sent_at: new Date().toISOString(),
    } as any).eq("id", threat.id);
    return { ok: true, action: "user_warned" };
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------
Deno.serve(async (req) => {
    const origin = req.headers.get("origin");
    const pre = handlePreflight(req); if (pre) return pre;
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "missing_bearer" }, 401, origin);

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid_session" }, 401, origin);
    const userId = userData.user.id;

    let body: { threat_id?: string; threat_ids?: string[]; action?: string };
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }

    const action = body.action;
    if (!action || !["quarantine", "warn", "release"].includes(action)) {
        return json({ error: "unsupported_action" }, 400, origin);
    }

    const collected: string[] = [];
    if (body.threat_id) collected.push(body.threat_id);
    if (Array.isArray(body.threat_ids)) collected.push(...body.threat_ids.filter(x => typeof x === "string"));
    const ids = Array.from(new Set(collected.filter(Boolean)));
    if (ids.length === 0) return json({ error: "missing_threat_id_or_threat_ids" }, 400, origin);
    if (ids.length > BULK_LIMIT) return json({ error: "too_many_threats", max: BULK_LIMIT, received: ids.length }, 400, origin);

    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const tenantCache = new Map<string, TenantRow>();

    const results: Array<{
        threat_id: string;
        ok: boolean;
        action?: string;
        error?: string;
        campaign?: { swept: number; failed: number; sibling_count: number };
    }> = [];
    for (const tid of ids) {
        try {
            const r = await actOnThreat(userClient, userId, tid, action as any, tenantCache);
            results.push({ threat_id: tid, ...r });
        } catch (e: any) {
            results.push({ threat_id: tid, ok: false, error: e?.message ?? "exception" });
        }
    }

    const okCount = results.filter(r => r.ok).length;
    return json({ results, summary: { total: results.length, ok: okCount, failed: results.length - okCount } }, 200, origin);
});
