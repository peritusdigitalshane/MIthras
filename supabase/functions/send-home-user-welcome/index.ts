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

function buildHtml(opts: { email: string; installCommand: string; enrolmentCode: string; accountSetupUrl?: string | null }): string {
    // Step 1 is the magic-link sign-in. If we somehow don't have a link, we
    // degrade gracefully to a /login pointer so the email still onboards.
    const signinHref = opts.accountSetupUrl ?? "https://www.mithras.com.au/login";
    const signinHelper = opts.accountSetupUrl
        ? `Click once and you're in — no password required. Link is valid for 24 hours; if it expires, request another from <a href="https://www.mithras.com.au/login" style="color:#10b981;text-decoration:underline;">www.mithras.com.au/login</a>.`
        : `Open <a href="https://www.mithras.com.au/login" style="color:#10b981;text-decoration:underline;">www.mithras.com.au/login</a>, enter <strong>${escapeHtml(opts.email)}</strong>, and click "Email me a sign-in link".`;

    return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">

      <!-- Header -->
      <tr><td style="padding:32px 32px 24px;background:linear-gradient(135deg,#0b0c0e 0%,#1f2937 100%);text-align:center;">
        <div style="color:#10b981;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Mithras Personal</div>
        <div style="color:#fff;font-size:24px;font-weight:700;margin-top:6px;">Welcome — three steps to protected.</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:8px;">Sent to ${escapeHtml(opts.email)} · Mithras Threat Defence · Australia</div>
      </td></tr>

      <!-- Intro -->
      <tr><td style="padding:24px 32px 8px;font-size:14px;line-height:1.6;color:#0b0c0e;">
        <p style="margin:0;">Thanks for subscribing. This email is everything you need to get up and running. About 5 minutes total. Follow the three steps below in order.</p>
      </td></tr>

      <!-- STEP 1: Sign in -->
      <tr><td style="padding:20px 32px 0;">
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;">
          <div style="display:inline-block;background:#10b981;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:0.6px;">STEP 1 OF 3</div>
          <h2 style="font-size:18px;margin:10px 0 6px;">Sign in to your Mithras account</h2>
          <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#374151;">Your account lives at <strong>www.mithras.com.au/account</strong>. From there you'll see installed devices, manage billing, and download monthly reports.</p>
          <p style="margin:0 0 8px;"><a href="${escapeHtml(signinHref)}" style="display:inline-block;background:#10b981;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Sign in to my account &rarr;</a></p>
          <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">${signinHelper}</p>
        </div>
      </td></tr>

      <!-- STEP 2: Install -->
      <tr><td style="padding:14px 32px 0;">
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;">
          <div style="display:inline-block;background:#10b981;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:0.6px;">STEP 2 OF 3</div>
          <h2 style="font-size:18px;margin:10px 0 6px;">Install Mithras on your Windows PC</h2>
          <ol style="padding-left:18px;margin:0 0 12px;font-size:13px;line-height:1.6;color:#374151;">
            <li>Open <strong>PowerShell as Administrator</strong>. (Press the Windows key, type "powershell", right-click <em>Windows PowerShell</em>, choose "Run as administrator", accept the UAC prompt.)</li>
            <li>Paste the command below and press <strong>Enter</strong>.</li>
            <li>Wait ~3 minutes. When it says <em>"Mithras agent enrolled successfully"</em> you're done.</li>
          </ol>
          <div style="background:#0b0c0e;color:#10b981;padding:14px;border-radius:8px;font-family:'SF Mono',Consolas,Monaco,monospace;font-size:11px;line-height:1.5;word-break:break-all;margin-top:6px;">${escapeHtml(opts.installCommand)}</div>
          <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Single-use enrolment code: <span style="font-family:'SF Mono',monospace;font-weight:600;">${escapeHtml(opts.enrolmentCode)}</span> · valid 90 days · install on one PC.</p>
        </div>
      </td></tr>

      <!-- STEP 3: Verify -->
      <tr><td style="padding:14px 32px 4px;">
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;">
          <div style="display:inline-block;background:#10b981;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:0.6px;">STEP 3 OF 3</div>
          <h2 style="font-size:18px;margin:10px 0 6px;">Confirm you're protected</h2>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#374151;">On your PC, look for the <strong>green Mithras shield</strong> in the Windows system tray (near the clock, bottom-right). That means the agent is running.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">Back in your account at <strong>www.mithras.com.au/account</strong>, refresh the page — your PC will appear under <em>Protected devices</em> within a minute of install.</p>
        </div>
      </td></tr>

      <!-- What happens next -->
      <tr><td style="padding:20px 32px 8px;font-size:14px;line-height:1.6;color:#0b0c0e;">
        <h3 style="font-size:15px;margin:8px 0 8px;">What happens next</h3>
        <ul style="padding-left:18px;margin:0;font-size:13px;color:#374151;">
          <li><strong>Continuous protection:</strong> Mithras runs in the background and hardens Windows Defender's behavior detection, ransomware shields, and firewall rules.</li>
          <li><strong>Prompt alerts:</strong> if anything serious is detected on your PC, you'll get an email as soon as our SOC sees it.</li>
          <li><strong>Monthly summary report:</strong> first of every month, by email — what we caught, what we blocked, and your security score.</li>
          <li><strong>Cancel any time:</strong> sign in to your account and click "Update card or cancel" — handled by Stripe.</li>
        </ul>
      </td></tr>

      <!-- Need help -->
      <tr><td style="padding:6px 32px 24px;font-size:14px;line-height:1.6;color:#0b0c0e;">
        <h3 style="font-size:15px;margin:16px 0 8px;">Need help?</h3>
        <p style="margin:0;font-size:13px;color:#374151;">Reply to this email or write to <a href="mailto:support@mithras.com.au" style="color:#10b981;">support@mithras.com.au</a>. We're Australian-based and typically reply within one business day.</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
        Mithras Threat Defence · Australian-owned and Australian-supported.<br/>
        You're receiving this because you subscribed to Mithras Personal. Manage your subscription at <a href="https://www.mithras.com.au/account" style="color:#6b7280;text-decoration:underline;">www.mithras.com.au/account</a>.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildText(opts: { email: string; installCommand: string; enrolmentCode: string; accountSetupUrl?: string | null }): string {
    const signinLine = opts.accountSetupUrl
        ? `${opts.accountSetupUrl}\n(no password needed; link valid for 24 hours)`
        : `Open https://www.mithras.com.au/login, enter ${opts.email}, then click "Email me a sign-in link"`;
    return [
        "Welcome to Mithras Personal.",
        "",
        "Three steps to protected. About 5 minutes total.",
        "",
        "STEP 1 OF 3 — SIGN IN TO YOUR ACCOUNT",
        signinLine,
        "Your account at www.mithras.com.au/account is where you see devices, billing and reports.",
        "",
        "STEP 2 OF 3 — INSTALL ON YOUR WINDOWS PC",
        "Open PowerShell as Administrator (Start menu → type 'powershell' → right-click → 'Run as administrator'). Paste this command and press Enter:",
        "",
        opts.installCommand,
        "",
        `Enrolment code: ${opts.enrolmentCode}  (single-use, valid 90 days)`,
        "Wait ~3 minutes for the install to finish.",
        "",
        "STEP 3 OF 3 — CONFIRM YOU'RE PROTECTED",
        "On your PC, look for the green Mithras shield in the Windows system tray.",
        "On www.mithras.com.au/account, refresh — your PC appears under 'Protected devices' within a minute.",
        "",
        "WHAT HAPPENS NEXT",
        "- Continuous protection of Windows Defender behavior detection, ransomware shields, firewall",
        "- Email alerts as soon as our SOC sees anything serious on your PC",
        "- Monthly summary report first of every month",
        "- Cancel any time from www.mithras.com.au/account",
        "",
        "Need help? Reply to this email or write to support@mithras.com.au.",
        "Australian-based, typically reply within one business day.",
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

    let body: { org_id?: string; email?: string; enrolment_code?: string; account_setup_url?: string | null } = {};
    try { body = await req.json(); } catch {}
    const orgId = String(body.org_id ?? "");
    const email = String(body.email ?? "").toLowerCase();
    const code  = String(body.enrolment_code ?? "");
    const accountSetupUrl = body.account_setup_url || null;
    if (!orgId || !isValidEmail(email) || !code) {
        return jsonResp({ error: "missing_args" }, 400, origin);
    }

    const smtp = await getSmtpSettings();
    if ("error" in smtp) return jsonResp({ error: smtp.error }, 400, origin);

    const installCommand = `iwr -UseBasicParsing "${AGENT_BUNDLE_URL.replace("/latest.json","/install-personal.ps1")}" | iex; Install-MithrasPersonal -Code "${code}"`;

    const html = buildHtml({ email, installCommand, enrolmentCode: code, accountSetupUrl });
    const text = buildText({ email, installCommand, enrolmentCode: code, accountSetupUrl });

    // SendGrid wraps every link in our emails through url3865.mithras.com.au
    // for click tracking. That breaks single-use magic links: Microsoft 365
    // Safe Links (and most enterprise scanners) pre-fetch links to check for
    // malware, which silently consumes the GoTrue token before the user
    // clicks. The X-SMTPAPI header tells SendGrid to disable click + open
    // tracking on THIS message only; transactional / marketing emails that
    // need analytics can still get wrapping if they're sent without this
    // override.
    const sendgridDisableTracking = JSON.stringify({
        filters: {
            clicktrack: { settings: { enable: 0, enable_text: false } },
            opentrack:  { settings: { enable: 0 } },
        },
    });
    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    const rfcBody = [
        `From: ${encodeHeader(smtp.fromName)} <${sanitizeHeader(smtp.fromEmail)}>`,
        `To: ${sanitizeHeader(email)}`,
        `Subject: ${encodeHeader("Mithras Personal: complete your setup in 3 steps")}`,
        `MIME-Version: 1.0`,
        `X-SMTPAPI: ${sendgridDisableTracking}`,
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
