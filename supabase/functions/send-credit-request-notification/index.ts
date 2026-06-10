// POST /functions/v1/send-credit-request-notification
//
// Fired by the frontend after request_credits / approve_credit_request /
// decline_credit_request mutations succeed. Sends a single transactional
// email to the appropriate party.
//
// Body: { request_id: uuid, action: "submitted" | "approved" | "declined" }
// Auth: service-role bearer OR a user JWT — we re-verify the request via
//       the service-role client so a forged frontend can't email arbitrary
//       people, only the recipients tied to this credit_request row.
//
// Uses the same SMTP plumbing pattern as send-deal-notifications. Returns
// {error: "smtp_disabled"} cleanly when SMTP isn't configured yet so the
// frontend mutation still succeeds.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface SmtpSettings {
    host: string; port: number; username: string; password: string;
    fromEmail: string; fromName: string; useStarttls: boolean;
}

function jsonResp(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getSmtpSettings(): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase.from("platform_settings").select("key,value")
        .in("key", ["smtp_provider","smtp_host","smtp_port","smtp_username","smtp_password","smtp_from_email","smtp_from_name","smtp_use_starttls"]);
    const map: Record<string, unknown> = {};
    for (const row of (data ?? [])) map[row.key as string] = row.value;
    if ((map.smtp_provider ?? "disabled") === "disabled") return { error: "smtp_disabled" };
    if (!map.smtp_host || !map.smtp_username || !map.smtp_password) return { error: "smtp_not_configured" };
    return {
        host: String(map.smtp_host), port: Number(map.smtp_port ?? 587),
        username: String(map.smtp_username), password: String(map.smtp_password),
        fromEmail: String(map.smtp_from_email ?? ""), fromName: String(map.smtp_from_name ?? "Mithras"),
        useStarttls: map.smtp_use_starttls !== false && map.smtp_use_starttls !== "false",
    };
}

async function sendStartTls(s: SmtpSettings, to: string, rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder(), dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read   = async () => { const n = await conn.read(buf); return n ? dec.decode(buf.subarray(0, n)) : ""; };
    const write  = async (l: string) => { await conn.write(enc.encode(l + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); };

    await expect("220");
    await write(`EHLO mithras.com.au`); await expect("250");
    if (!s.useStarttls) { try { conn.close(); } catch {} throw new Error("non_tls_send_refused"); }
    await write("STARTTLS"); await expect("220");

    const tls = await Deno.startTls(conn, { hostname: s.host });
    const tEnc = new TextEncoder(), tDec = new TextDecoder();
    const tBuf = new Uint8Array(8192);
    const tRead   = async () => { const n = await tls.read(tBuf); return n ? tDec.decode(tBuf.subarray(0, n)) : ""; };
    const tWrite  = async (l: string) => { await tls.write(tEnc.encode(l + "\r\n")); };
    const tExpect = async (cp: string) => { const r = await tRead(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); };

    await tWrite(`EHLO mithras.com.au`); await tExpect("250");
    await tWrite("AUTH LOGIN"); await tExpect("334");
    await tWrite(btoa(s.username)); await tExpect("334");
    await tWrite(btoa(s.password)); await tExpect("235");
    await tWrite(`MAIL FROM:<${s.fromEmail}>`); await tExpect("250");
    await tWrite(`RCPT TO:<${to}>`); await tExpect("250");
    await tWrite("DATA"); await tExpect("354");
    const safe = rfcBody.replace(/^\./gm, "..");
    await tls.write(tEnc.encode(safe + "\r\n.\r\n"));
    await tExpect("250");
    await tWrite("QUIT");
    try { tls.close(); } catch {}
}

function buildRfcMessage(opts: { smtp: SmtpSettings; to: string; subject: string; html: string; text: string }): string {
    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    return [
        `From: ${encodeHeader(opts.smtp.fromName)} <${sanitizeHeader(opts.smtp.fromEmail)}>`,
        `To: ${sanitizeHeader(opts.to)}`,
        `Subject: ${encodeHeader(opts.subject)}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        opts.text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        opts.html,
        ``,
        `--${boundary}--`,
    ].join("\r\n");
}

interface NotificationContext {
    request:           any;
    reseller:          { id: string; name: string };
    distributor:       { id: string; name: string };
    resellerAdmins:    Array<{ email: string; display_name: string | null }>;
    distributorAdmins: Array<{ email: string; display_name: string | null }>;
}

async function loadContext(requestId: string): Promise<NotificationContext> {
    const { data: req } = await supabase.from("credit_requests").select("*").eq("id", requestId).maybeSingle();
    if (!req) throw new Error("request_not_found");

    const [{ data: resellerOrg }, { data: distOrg }] = await Promise.all([
        supabase.from("organizations").select("id, name").eq("id", req.reseller_org_id).maybeSingle(),
        supabase.from("organizations").select("id, name").eq("id", req.distributor_org_id).maybeSingle(),
    ]);
    if (!resellerOrg || !distOrg) throw new Error("org_not_found");

    // Fetch admin members for each side. Email comes from auth.users via profiles.
    const fetchAdmins = async (orgId: string) => {
        const { data: memberships } = await supabase
            .from("organization_memberships")
            .select("user_id, role")
            .eq("organization_id", orgId)
            .in("role", ["admin", "owner"]);
        const userIds = (memberships ?? []).map((m: any) => m.user_id).filter(Boolean);
        if (userIds.length === 0) return [];
        const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email, display_name")
            .in("id", userIds);
        return (profiles ?? []).filter((p: any) => p.email && isValidEmail(p.email));
    };
    const [resellerAdmins, distributorAdmins] = await Promise.all([
        fetchAdmins(req.reseller_org_id), fetchAdmins(req.distributor_org_id),
    ]);

    return {
        request:           req,
        reseller:          resellerOrg,
        distributor:       distOrg,
        resellerAdmins,
        distributorAdmins,
    };
}

function buildSubmittedEmail(ctx: NotificationContext): { html: string; text: string; subject: string } {
    const q = ctx.request.quantity;
    const note = ctx.request.notes ? `<p>Note: <em>${escapeHtml(ctx.request.notes)}</em></p>` : "";
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="color:#4f46e5">New credit request from ${escapeHtml(ctx.reseller.name)}</h2>
        <p>They've requested <strong>${q} credits</strong> on the Mithras platform.</p>
        ${note}
        <p>Approve or decline from your distributor portal:</p>
        <p><a href="${SITE_URL}/distributor/credits" style="display:inline-block;background:#4f46e5;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open distributor credits →</a></p>
        <p style="font-size:12px;color:#64748b;margin-top:24px">You're getting this because you're an admin on ${escapeHtml(ctx.distributor.name)}. One pending request per reseller — they can't submit another until you respond.</p>
    </body></html>`;
    const text = `New credit request from ${ctx.reseller.name}\n\nThey've requested ${q} credits.${ctx.request.notes ? `\n\nNote: ${ctx.request.notes}` : ""}\n\nApprove or decline at ${SITE_URL}/distributor/credits\n`;
    return { html, text, subject: `[Mithras] ${ctx.reseller.name} requests ${q} credits` };
}

function buildApprovedEmail(ctx: NotificationContext): { html: string; text: string; subject: string } {
    const q = ctx.request.quantity;
    const note = ctx.request.resolution_notes ? `<p>From ${escapeHtml(ctx.distributor.name)}: <em>${escapeHtml(ctx.request.resolution_notes)}</em></p>` : "";
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="color:#10b981">Credits approved — ${q} added to your pool</h2>
        <p><strong>${escapeHtml(ctx.distributor.name)}</strong> approved your request. ${q} credits are in your pool now.</p>
        ${note}
        <p><a href="${SITE_URL}/partner/credits" style="display:inline-block;background:#10b981;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">View your credits →</a></p>
    </body></html>`;
    const text = `Credits approved — ${q} added to your pool\n\n${ctx.distributor.name} approved your request. ${q} credits are in your pool now.${ctx.request.resolution_notes ? `\n\nFrom ${ctx.distributor.name}: ${ctx.request.resolution_notes}` : ""}\n\nView at ${SITE_URL}/partner/credits\n`;
    return { html, text, subject: `[Mithras] ${q} credits approved by ${ctx.distributor.name}` };
}

function buildDeclinedEmail(ctx: NotificationContext): { html: string; text: string; subject: string } {
    const q = ctx.request.quantity;
    const reason = ctx.request.resolution_notes ? `<p>Reason from ${escapeHtml(ctx.distributor.name)}: <em>${escapeHtml(ctx.request.resolution_notes)}</em></p>` : "";
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="color:#dc2626">Credit request declined</h2>
        <p><strong>${escapeHtml(ctx.distributor.name)}</strong> declined your request for ${q} credits.</p>
        ${reason}
        <p>You can submit a new request from your partner portal once you've addressed their reason.</p>
        <p><a href="${SITE_URL}/partner/credits" style="display:inline-block;background:#4f46e5;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open credits →</a></p>
    </body></html>`;
    const text = `Credit request declined\n\n${ctx.distributor.name} declined your request for ${q} credits.${ctx.request.resolution_notes ? `\n\nReason: ${ctx.request.resolution_notes}` : ""}\n\nOpen ${SITE_URL}/partner/credits\n`;
    return { html, text, subject: `[Mithras] Credit request declined by ${ctx.distributor.name}` };
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405, origin);

    let body: { request_id?: string; action?: string } = {};
    try { body = await req.json(); } catch {}
    if (!body.request_id) return jsonResp({ error: "request_id_required" }, 400, origin);
    if (!body.action || !["submitted", "approved", "declined"].includes(body.action)) {
        return jsonResp({ error: "invalid_action" }, 400, origin);
    }

    // Service-role-backed auth: anyone with a JWT can call this, but we
    // only read the request server-side and email the recipients already
    // tied to that row. No way to spam arbitrary people.
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return jsonResp({ error: "auth_required" }, 401, origin);

    const smtp = await getSmtpSettings();
    if ("error" in smtp) return jsonResp({ error: smtp.error }, 200, origin); // not fatal — request itself succeeded

    let ctx: NotificationContext;
    try {
        ctx = await loadContext(body.request_id);
    } catch (e: any) {
        return jsonResp({ error: e.message ?? "context_load_failed" }, 500, origin);
    }

    let recipients: Array<{ email: string }>;
    let built: { html: string; text: string; subject: string };
    if (body.action === "submitted") {
        recipients = ctx.distributorAdmins;
        built      = buildSubmittedEmail(ctx);
    } else if (body.action === "approved") {
        recipients = ctx.resellerAdmins;
        built      = buildApprovedEmail(ctx);
    } else {
        recipients = ctx.resellerAdmins;
        built      = buildDeclinedEmail(ctx);
    }

    let sent = 0, failed = 0;
    for (const r of recipients) {
        try {
            const msg = buildRfcMessage({ smtp, to: r.email, ...built });
            await sendStartTls(smtp, r.email, msg);
            sent++;
        } catch (e) {
            console.error(`send failed for ${r.email}`, e);
            failed++;
        }
    }
    return jsonResp({ sent, failed }, 200, origin);
});
