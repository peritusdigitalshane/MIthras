// POST /functions/v1/notify-alert
//
// Called by the queue_alert_notification DB trigger. Looks up the alert,
// resolves the org's recipients filtered by severity, and ships an email
// via SMTP STARTTLS to each one. Failures are written back to
// alerts.notification_error; successes update notified_at + delivered_to.
//
// Body: { alert_id: uuid }
// Auth: service-role bearer only (the trigger has the key).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const SOC_URL              = Deno.env.get("SOC_URL")  ?? "https://soc.mithras.com.au";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SEVERITY_ORDER: Record<string, number> = {
    "low": 0, "moderate": 1, "high": 2, "severe": 3,
    // Lowercase variants and CamelCase from Defender:
    "Low": 0, "Moderate": 1, "High": 2, "Severe": 3,
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

interface SmtpSettings {
    host: string; port: number; username: string; password: string;
    fromEmail: string; fromName: string; useStarttls: boolean;
}

async function getSmtpSettings(): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase
        .from("platform_settings")
        .select("key,value")
        .in("key", [
            "smtp_provider","smtp_host","smtp_port","smtp_username",
            "smtp_password","smtp_from_email","smtp_from_name","smtp_use_starttls",
        ]);
    const m: Record<string, unknown> = {};
    for (const r of (data ?? [])) m[r.key as string] = r.value;
    if ((m.smtp_provider ?? "disabled") === "disabled") return { error: "smtp_disabled" };
    if (!m.smtp_host || !m.smtp_username || !m.smtp_password) return { error: "smtp_not_configured" };
    return {
        host: String(m.smtp_host),
        port: Number(m.smtp_port ?? 587),
        username: String(m.smtp_username),
        password: String(m.smtp_password),
        fromEmail: String(m.smtp_from_email ?? m.smtp_username),
        fromName:  String(m.smtp_from_name ?? "Mithras"),
        useStarttls: m.smtp_use_starttls !== false,
    };
}

async function sendStarttls(s: SmtpSettings, recipients: string[], rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder(); const dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read   = async () => { const n = await conn.read(buf); if (!n) return ""; return dec.decode(buf.subarray(0, n)); };
    const write  = async (l: string) => { await conn.write(enc.encode(l + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await expect("220"); await write(`EHLO mithras.com.au`); await expect("250");
    if (!s.useStarttls) { try { conn.close(); } catch {} throw new Error("non_tls_send_refused"); }
    await write("STARTTLS"); await expect("220");
    const tls = await Deno.startTls(conn, { hostname: s.host });
    const tEnc = new TextEncoder(); const tDec = new TextDecoder(); const tBuf = new Uint8Array(8192);
    const tRead = async () => { const n = await tls.read(tBuf); if (!n) return ""; return tDec.decode(tBuf.subarray(0, n)); };
    const tWrite = async (l: string) => { await tls.write(tEnc.encode(l + "\r\n")); };
    const tExpect = async (cp: string) => { const r = await tRead(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await tWrite(`EHLO mithras.com.au`); await tExpect("250");
    await tWrite("AUTH LOGIN"); await tExpect("334");
    await tWrite(btoa(s.username)); await tExpect("334");
    await tWrite(btoa(s.password)); await tExpect("235");
    await tWrite(`MAIL FROM:<${s.fromEmail}>`); await tExpect("250");
    for (const r of recipients) { await tWrite(`RCPT TO:<${r}>`); await tExpect("250"); }
    await tWrite("DATA"); await tExpect("354");
    const safe = rfcBody.replace(/^\./gm, "..");
    await tls.write(tEnc.encode(safe + "\r\n.\r\n")); await tExpect("250");
    await tWrite("QUIT");
    try { tls.close(); } catch { /* QUIT already closed it */ }
}

function severityScore(sev: string | null | undefined): number {
    if (!sev) return 0;
    const s = String(sev).toLowerCase();
    return SEVERITY_ORDER[s] ?? 0;
}

// escapeHtml lives in ../_shared/mime-safe.ts (imported at the top).

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Service-role bearer required (the trigger has the key).
    const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (tok !== SUPABASE_SERVICE_KEY) return jsonResponse({ error: "service_role_required" }, 401, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }
    const alertId = String(body.alert_id ?? "");
    if (!alertId) return jsonResponse({ error: "alert_id_required" }, 400, origin);

    const { data: alert, error: aErr } = await supabase
        .from("alerts").select("*").eq("id", alertId).maybeSingle();
    if (aErr || !alert) return jsonResponse({ error: "alert_not_found" }, 404, origin);

    const [orgRes, recipRes, endpointRes] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", alert.organization_id).maybeSingle(),
        supabase.from("org_alert_recipients")
            .select("email,name,min_severity")
            .eq("organization_id", alert.organization_id)
            .eq("enabled", true),
        alert.endpoint_id
            ? supabase.from("endpoints").select("hostname").eq("id", alert.endpoint_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);

    if (orgRes.error || !orgRes.data) {
        return jsonResponse({ error: "org_lookup_failed" }, 500, origin);
    }
    const orgName = orgRes.data.name as string;
    const hostname = (endpointRes as any).data?.hostname ?? "(unknown endpoint)";

    const sevScore = severityScore(alert.severity as string);
    const recipients = (recipRes.data ?? []).filter(
        (r) => sevScore >= severityScore(r.min_severity as string),
    );
    // Validate every recipient before passing to RCPT TO: or the header. An
    // org-admin who controls org_alert_recipients.email could otherwise
    // inject CR/LF to smuggle headers or break the SMTP envelope.
    const emails = recipients
        .map((r) => String(r.email).trim().toLowerCase())
        .filter((e) => isValidEmail(e));
    if (emails.length === 0) {
        // Two failure modes shared this branch — no recipient row matched
        // OR the rows were present but every address failed validation.
        // The second `if` was unreachable; pick the right skip reason.
        const skipReason = recipients.length === 0 ? "no_recipients_for_severity" : "no_valid_emails";
        return jsonResponse({ ok: true, skipped: skipReason }, 200, origin);
    }

    const smtp = await getSmtpSettings();
    if ("error" in smtp) {
        await supabase.from("alerts").update({ notification_error: smtp.error }).eq("id", alertId);
        return jsonResponse({ error: smtp.error }, 400, origin);
    }

    const sevLabel = String(alert.severity ?? "");
    const subject = `[${sevLabel}] ${orgName}: ${alert.title}`;
    const text =
`A new ${sevLabel} alert was raised for ${orgName}.

Endpoint: ${hostname}
Title:    ${alert.title}
Time:     ${new Date(alert.created_at).toUTCString()}

${alert.message ?? ""}

Open in the SOC:
${SOC_URL}/alerts

— Mithras Threat Defence`;

    const html = `<!doctype html><html><body style="font-family:Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:640px;margin:24px auto;padding:0 16px">
<h2 style="color:${sevScore >= 2 ? "#dc2626" : "#0f172a"};margin:0 0 12px 0">${escapeHtml(sevLabel)} alert: ${escapeHtml(String(alert.title))}</h2>
<p style="color:#64748b;margin:0 0 16px 0">${escapeHtml(orgName)} &middot; ${new Date(String(alert.created_at)).toUTCString()}</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
  <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569">Endpoint</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(hostname)}</strong></td></tr>
  <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569">Severity</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(sevLabel)}</td></tr>
  <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569">Type</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(String(alert.alert_type ?? ""))}</td></tr>
</table>
<p style="font-size:14px;color:#0f172a;line-height:1.5">${escapeHtml(String(alert.message ?? ""))}</p>
<p style="margin-top:20px"><a href="${SOC_URL}/alerts" style="background:#00C4AB;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open in SOC</a></p>
<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:14px;margin-top:30px">Mithras Threat Defence &middot; <a href="${SITE_URL}" style="color:#64748b">${SITE_URL}</a></p>
</body></html>`;

    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    // Sanitize every dynamic value that lands in a header. Subject + fromName
    // get RFC-2047 encoded so non-ASCII (e.g. an emoji in the org name)
    // round-trips cleanly; fromEmail + recipient addrs are CRLF-stripped.
    const headerFromName = encodeHeader(smtp.fromName);
    const headerFromEmail = sanitizeHeader(smtp.fromEmail);
    const headerSubject = encodeHeader(subject);
    const headerTo = emails.map(sanitizeHeader).join(", ");
    const mime = [
        `From: ${headerFromName} <${headerFromEmail}>`,
        `To: ${headerTo}`,
        `Subject: ${headerSubject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        html,
        ``,
        `--${boundary}--`,
    ].join("\r\n");

    try {
        await sendStarttls(smtp, emails, mime);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("alerts").update({ notification_error: msg }).eq("id", alertId);
        return jsonResponse({ error: "smtp_send_failed", details: msg }, 502, origin);
    }

    await supabase.from("alerts").update({
        notified_at: new Date().toISOString(),
        delivered_to: emails,
        notification_error: null,
    }).eq("id", alertId);

    return jsonResponse({ ok: true, sent_to: emails }, 200, origin);
});
