// POST /functions/v1/send-deal-notifications
//
// Daily-cron-triggered notifier for deal-registration lifecycle. Two paths:
//
//   1. Expiry warnings — for any active deal whose protection_expires_at
//      falls within the next 7 days, email the reseller admins with the
//      deal details and CTAs to advance the stage or mark lost. One email
//      per reseller per day (not per deal) to avoid inbox fatigue.
//
//   2. Distributor mediation digest — for any new deal registered in the
//      last 24 hours, email the distributor admins so they have channel
//      visibility without having to log in.
//
// Body: { mode: "expiry" | "new_deals" | "all" }  default "all"
// Auth: service-role bearer (called by pg_cron via an edge invocation).
//
// Uses the existing SMTP infrastructure from /opt/peritus-functions/_shared.

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
        fromEmail: String(map.smtp_from_email ?? map.smtp_username),
        fromName:  String(map.smtp_from_name ?? "Mithras"),
        useStarttls: map.smtp_use_starttls !== false,
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
        `Content-Transfer-Encoding: 7bit`,
        ``,
        opts.text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        opts.html,
        ``,
        `--${boundary}--`,
        ``,
    ].join("\r\n");
}

// Tiny HTML/text builder for the expiry digest.
function buildExpiryEmail(opts: { resellerName: string; deals: { name: string; stage: string; daysLeft: number; estEndpoints: number }[] }): { html: string; text: string } {
    const rows = opts.deals.map(d => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${escapeHtml(d.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escapeHtml(d.stage)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;color:#dc2626;font-weight:600;">${d.daysLeft <= 0 ? "Expiring today" : `${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}`}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;">${d.estEndpoints}</td>
      </tr>`).join("");

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;"><tr><td align="center">
<table cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
<tr><td style="padding:24px 28px;background:linear-gradient(135deg,#1a1a1d 0%,#2a2a30 100%);">
  <div style="color:#f59e0b;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Deal protection expiring</div>
  <div style="color:#fff;font-size:22px;font-weight:700;margin-top:6px;">${opts.deals.length} deal${opts.deals.length === 1 ? "" : "s"} need${opts.deals.length === 1 ? "s" : ""} attention this week</div>
</td></tr>
<tr><td style="padding:24px 28px;">
  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;">Hi ${escapeHtml(opts.resellerName)} team,</p>
  <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">The deal registrations below are within 7 days of expiring. Advance their stage to refresh the protection window, or mark them lost so the slot frees up.</p>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;">
    <thead><tr>
      <th align="left"  style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Prospect</th>
      <th align="left"  style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Stage</th>
      <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Time left</th>
      <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Est. EPs</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin:20px 0 0;font-size:13px;color:#4b5563;">
    Open the pipeline: <a href="${SITE_URL}/partner/deals" style="color:#D4A437;">${SITE_URL}/partner/deals</a>
  </p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;">
  This is an automated reminder. Reply to this email if anything looks off.
</td></tr>
</table></td></tr></table></body></html>`;

    const text = [
        `Hi ${opts.resellerName} team,`,
        ``,
        `${opts.deals.length} deal registration${opts.deals.length === 1 ? "" : "s"} ${opts.deals.length === 1 ? "is" : "are"} within 7 days of expiring:`,
        ``,
        ...opts.deals.map(d => `  - ${d.name} (${d.stage}, ${d.daysLeft <= 0 ? "expiring today" : `${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left`}, est ${d.estEndpoints} endpoints)`),
        ``,
        `Open the pipeline: ${SITE_URL}/partner/deals`,
    ].join("\n");

    return { html, text };
}

function buildNewDealsEmail(opts: { distributorName: string; deals: { resellerName: string; prospectName: string; stage: string; estEndpoints: number; createdAt: string }[] }): { html: string; text: string } {
    const rows = opts.deals.map(d => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${escapeHtml(d.prospectName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escapeHtml(d.resellerName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;">${d.estEndpoints}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:right;">${new Date(d.createdAt).toLocaleString("en-AU")}</td>
      </tr>`).join("");

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;"><tr><td align="center">
<table cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
<tr><td style="padding:24px 28px;background:linear-gradient(135deg,#1a1a1d 0%,#2a2a30 100%);">
  <div style="color:#D4A437;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Channel pipeline update</div>
  <div style="color:#fff;font-size:22px;font-weight:700;margin-top:6px;">${opts.deals.length} new deal${opts.deals.length === 1 ? "" : "s"} registered yesterday</div>
</td></tr>
<tr><td style="padding:24px 28px;">
  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;">Hi ${escapeHtml(opts.distributorName)} team,</p>
  <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">Your resellers registered the deals below in the last 24 hours. This is for your channel-visibility — no action required unless you want to mediate or co-sell.</p>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;">
    <thead><tr>
      <th align="left"  style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Prospect</th>
      <th align="left"  style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Reseller</th>
      <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Est. EPs</th>
      <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Registered</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin:20px 0 0;font-size:13px;color:#4b5563;">
    Full pipeline: <a href="${SITE_URL}/distributor/deals" style="color:#D4A437;">${SITE_URL}/distributor/deals</a>
  </p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;">
  Daily channel digest. Reply if you'd like to change cadence.
</td></tr>
</table></td></tr></table></body></html>`;

    const text = [
        `Hi ${opts.distributorName} team,`,
        ``,
        `${opts.deals.length} new deal${opts.deals.length === 1 ? "" : "s"} registered by your resellers in the last 24 hours:`,
        ``,
        ...opts.deals.map(d => `  - ${d.prospectName} (${d.resellerName}, est ${d.estEndpoints} endpoints, ${d.stage})`),
        ``,
        `Full pipeline: ${SITE_URL}/distributor/deals`,
    ].join("\n");

    return { html, text };
}

async function runExpiryDigest(smtp: SmtpSettings): Promise<{ resellers_emailed: number; deals_flagged: number }> {
    const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deals } = await supabase
        .from("deal_registrations")
        .select("id, reseller_org_id, prospect_name, stage, protection_expires_at, estimated_endpoints")
        .eq("status", "active")
        .lte("protection_expires_at", cutoff)
        .order("protection_expires_at", { ascending: true });
    const dealList = (deals ?? []) as Array<{
        id: string; reseller_org_id: string; prospect_name: string;
        stage: string; protection_expires_at: string; estimated_endpoints: number;
    }>;
    if (dealList.length === 0) return { resellers_emailed: 0, deals_flagged: 0 };

    // Group by reseller. For each reseller, look up their admin user emails
    // via organization_memberships → auth.users.
    const byReseller = new Map<string, typeof dealList>();
    for (const d of dealList) {
        const arr = byReseller.get(d.reseller_org_id) ?? [];
        arr.push(d);
        byReseller.set(d.reseller_org_id, arr);
    }

    let resellersEmailed = 0;
    for (const [resellerId, list] of byReseller.entries()) {
        const { data: org } = await supabase
            .from("organizations").select("name, billing_email").eq("id", resellerId).maybeSingle();
        // Prefer billing_email; fall back to admin user emails via auth.users.
        const recipients = new Set<string>();
        if ((org as any)?.billing_email && isValidEmail((org as any).billing_email)) {
            recipients.add(String((org as any).billing_email).toLowerCase());
        } else {
            const { data: memberships } = await supabase
                .from("organization_memberships").select("user_id, role").eq("organization_id", resellerId).in("role", ["admin","owner"]);
            for (const m of (memberships ?? [])) {
                const { data: u } = await supabase
                    .from("auth.users" as any).select("email").eq("id", (m as any).user_id).maybeSingle();
                if ((u as any)?.email && isValidEmail((u as any).email)) recipients.add(String((u as any).email).toLowerCase());
            }
        }

        if (recipients.size === 0) continue;

        const now = Date.now();
        const built = buildExpiryEmail({
            resellerName: (org as any)?.name ?? "Reseller",
            deals: list.map(d => ({
                name: d.prospect_name,
                stage: d.stage,
                daysLeft: Math.max(0, Math.floor((new Date(d.protection_expires_at).getTime() - now) / (24 * 60 * 60 * 1000))),
                estEndpoints: Number(d.estimated_endpoints),
            })),
        });

        for (const to of recipients) {
            try {
                const rfc = buildRfcMessage({
                    smtp, to,
                    subject: `${list.length} deal${list.length === 1 ? "" : "s"} expiring this week — Mithras pipeline`,
                    html: built.html, text: built.text,
                });
                await sendStartTls(smtp, to, rfc);
            } catch (e) {
                console.error("expiry email failed", to, e);
            }
        }
        resellersEmailed++;
    }
    return { resellers_emailed: resellersEmailed, deals_flagged: dealList.length };
}

async function runNewDealsDigest(smtp: SmtpSettings): Promise<{ distributors_emailed: number; deals_flagged: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deals } = await supabase
        .from("deal_registrations")
        .select("id, distributor_org_id, reseller_org_id, prospect_name, stage, estimated_endpoints, created_at")
        .gte("created_at", since)
        .not("distributor_org_id", "is", null);
    const list = (deals ?? []) as Array<{
        id: string; distributor_org_id: string; reseller_org_id: string;
        prospect_name: string; stage: string; estimated_endpoints: number; created_at: string;
    }>;
    if (list.length === 0) return { distributors_emailed: 0, deals_flagged: 0 };

    const byDisty = new Map<string, typeof list>();
    for (const d of list) {
        const arr = byDisty.get(d.distributor_org_id) ?? [];
        arr.push(d);
        byDisty.set(d.distributor_org_id, arr);
    }

    let distysEmailed = 0;
    for (const [distId, dlist] of byDisty.entries()) {
        const { data: org } = await supabase
            .from("organizations").select("name, billing_email").eq("id", distId).maybeSingle();
        const recipients = new Set<string>();
        if ((org as any)?.billing_email && isValidEmail((org as any).billing_email)) {
            recipients.add(String((org as any).billing_email).toLowerCase());
        }
        if (recipients.size === 0) continue;

        const built = buildNewDealsEmail({
            distributorName: (org as any)?.name ?? "Distributor",
            deals: await Promise.all(dlist.map(async d => {
                const { data: rseller } = await supabase
                    .from("organizations").select("name").eq("id", d.reseller_org_id).maybeSingle();
                return {
                    prospectName: d.prospect_name,
                    resellerName: (rseller as any)?.name ?? "Reseller",
                    stage: d.stage,
                    estEndpoints: Number(d.estimated_endpoints),
                    createdAt: d.created_at,
                };
            })),
        });

        for (const to of recipients) {
            try {
                const rfc = buildRfcMessage({
                    smtp, to,
                    subject: `${dlist.length} new deal${dlist.length === 1 ? "" : "s"} from your resellers — Mithras`,
                    html: built.html, text: built.text,
                });
                await sendStartTls(smtp, to, rfc);
            } catch (e) {
                console.error("new-deals email failed", to, e);
            }
        }
        distysEmailed++;
    }
    return { distributors_emailed: distysEmailed, deals_flagged: list.length };
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== SUPABASE_SERVICE_KEY) return jsonResp({ error: "service_role_required" }, 401, origin);

    let body: { mode?: string } = {};
    try { body = await req.json(); } catch {}
    const mode = (body.mode ?? "all").toLowerCase();

    const smtp = await getSmtpSettings();
    if ("error" in smtp) return jsonResp({ error: smtp.error }, 400, origin);

    const result: Record<string, unknown> = {};
    if (mode === "all" || mode === "expiry") {
        result.expiry = await runExpiryDigest(smtp);
    }
    if (mode === "all" || mode === "new_deals") {
        result.new_deals = await runNewDealsDigest(smtp);
    }
    return jsonResp({ ok: true, ...result }, 200, origin);
});
