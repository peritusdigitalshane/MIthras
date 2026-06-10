// POST /functions/v1/send-home-user-welcome
//
// Sends the post-checkout welcome email to a brand-new home-user customer.
// Includes the one-line PowerShell install command pre-filled with the
// enrolment code so the user can paste-and-run.
//
// Body: { org_id: uuid, email: string, enrolment_code: string }
// Auth: service-role bearer (called from stripe-webhook).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_BUNDLE_URL = Deno.env.get("AGENT_BUNDLE_URL")
    ?? "https://api.mithras.com.au/storage/v1/object/public/agent-bundles/latest.json";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface SmtpSettings { host: string; port: number; username: string; password: string; fromEmail: string; fromName: string; useStarttls: boolean; }

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

function buildHtml(opts: { email: string; installCommand: string; enrolmentCode: string }): string {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <tr><td style="padding:32px 32px 24px;background:linear-gradient(135deg,#0b0c0e 0%,#1f2937 100%);text-align:center;">
        <div style="color:#10b981;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Mithras Personal</div>
        <div style="color:#fff;font-size:24px;font-weight:700;margin-top:6px;">Welcome — your PC is one paste away.</div>
      </td></tr>

      <tr><td style="padding:24px 32px 8px;font-size:14px;line-height:1.6;color:#0b0c0e;">
        <p style="margin:0 0 12px 0;">Thanks for subscribing. Here's how to get your Windows PC protected in about 3 minutes.</p>
        <ol style="padding-left:20px;margin:0 0 16px;">
          <li><strong>Open PowerShell as Administrator</strong> on the PC you want to protect. (Start menu → type "powershell" → right-click → "Run as administrator".)</li>
          <li><strong>Paste the command below</strong> and press Enter.</li>
          <li>Wait ~3 minutes. The agent installs, starts, and you'll see "Mithras agent enrolled successfully" when it's done.</li>
        </ol>
      </td></tr>

      <tr><td style="padding:8px 32px 24px;">
        <div style="background:#0b0c0e;color:#10b981;padding:16px;border-radius:8px;font-family:'SF Mono',Consolas,Monaco,monospace;font-size:12px;line-height:1.5;word-break:break-all;">
          ${escapeHtml(opts.installCommand)}
        </div>
        <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Your enrolment code: <span style="font-family:'SF Mono',monospace;font-weight:600;">${escapeHtml(opts.enrolmentCode)}</span></p>
      </td></tr>

      <tr><td style="padding:0 32px 24px;font-size:14px;line-height:1.6;color:#0b0c0e;">
        <h3 style="font-size:15px;margin:8px 0 8px;">What happens after install</h3>
        <ul style="padding-left:20px;margin:0;">
          <li>Your PC starts reporting to Mithras immediately.</li>
          <li>If we detect anything serious, we'll email you (and call for active ransomware).</li>
          <li>Once a month we send you a summary report of what we caught.</li>
          <li>Cancel any time via the Stripe billing portal link in your payment receipt.</li>
        </ul>

        <h3 style="font-size:15px;margin:24px 0 8px;">Need help?</h3>
        <p style="margin:0;">Reply to this email or write to <a href="mailto:support@mithras.com.au" style="color:#10b981;">support@mithras.com.au</a>.</p>
      </td></tr>

      <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
        Mithras Threat Defence · Built by Peritus Digital · Australian-owned and Australian-supported.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildText(opts: { email: string; installCommand: string; enrolmentCode: string }): string {
    return [
        "Welcome to Mithras Personal.",
        "",
        "Open PowerShell as Administrator on the PC you want to protect, then paste and run:",
        "",
        opts.installCommand,
        "",
        `Your enrolment code: ${opts.enrolmentCode}`,
        "",
        "After install, your PC reports to Mithras. We'll email you if anything serious comes up.",
        "Once a month we'll send you a summary of what we caught.",
        "",
        "Need help? support@mithras.com.au",
    ].join("\n");
}

async function sendStartTls(s: SmtpSettings, to: string, rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder(), dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read = async () => { const n = await conn.read(buf); return n ? dec.decode(buf.subarray(0, n)) : ""; };
    const write = async (l: string) => { await conn.write(enc.encode(l + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); };

    await expect("220");
    await write(`EHLO mithras.com.au`); await expect("250");
    if (!s.useStarttls) { try { conn.close(); } catch {} throw new Error("non_tls_send_refused"); }
    await write("STARTTLS"); await expect("220");

    const tls = await Deno.startTls(conn, { hostname: s.host });
    const tEnc = new TextEncoder(), tDec = new TextDecoder();
    const tBuf = new Uint8Array(8192);
    const tRead = async () => { const n = await tls.read(tBuf); return n ? tDec.decode(tBuf.subarray(0, n)) : ""; };
    const tWrite = async (l: string) => { await tls.write(tEnc.encode(l + "\r\n")); };
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

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== SUPABASE_SERVICE_KEY) return jsonResp({ error: "service_role_required" }, 401, origin);

    let body: { org_id?: string; email?: string; enrolment_code?: string } = {};
    try { body = await req.json(); } catch {}
    const orgId = String(body.org_id ?? "");
    const email = String(body.email ?? "").toLowerCase();
    const code  = String(body.enrolment_code ?? "");
    if (!orgId || !isValidEmail(email) || !code) {
        return jsonResp({ error: "missing_args" }, 400, origin);
    }

    const smtp = await getSmtpSettings();
    if ("error" in smtp) return jsonResp({ error: smtp.error }, 400, origin);

    const installCommand = `iwr -UseBasicParsing "${AGENT_BUNDLE_URL.replace("/latest.json","/install-personal.ps1")}" | iex; Install-MithrasPersonal -Code "${code}"`;

    const html = buildHtml({ email, installCommand, enrolmentCode: code });
    const text = buildText({ email, installCommand, enrolmentCode: code });

    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    const rfcBody = [
        `From: ${encodeHeader(smtp.fromName)} <${sanitizeHeader(smtp.fromEmail)}>`,
        `To: ${sanitizeHeader(email)}`,
        `Subject: ${encodeHeader("Welcome to Mithras Personal — install in 3 minutes")}`,
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
        ``,
    ].join("\r\n");

    try {
        await sendStartTls(smtp, email, rfcBody);
    } catch (e: any) {
        return jsonResp({ error: "smtp_send_failed", details: e?.message }, 502, origin);
    }
    return jsonResp({ ok: true, sent_to: email }, 200, origin);
});
