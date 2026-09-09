// POST /functions/v1/send-signin-link
//
// Public-ish endpoint. Takes an email, generates a magic link via the GoTrue
// admin API, and emails it through the real SMTP relay (configured in
// platform_settings). Used by /login → "Email me a sign-in link" so home
// users who don't have a password — and anyone whose original magic link
// expired or was already used — can always get a fresh one.
//
// Body: { email: string }
// Auth: none.
// Privacy: we ALWAYS respond { ok: true } regardless of whether the email
// is registered. Don't leak account existence.
//
// Security: the redirect target is HARD-CODED to SITE_URL/account. We never
// accept a redirect_to from the request body. Doing so would be an
// open-redirect / OAuth-token-theft vector — after GoTrue verifies the
// magic link, it redirects to whatever URL is bound to the token, and the
// session token lands on that origin's URL fragment. Attacker-controlled
// origin = stolen session. Server-pinned only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface SmtpSettings { host: string; port: number; username: string; password: string; fromEmail: string; fromName: string; useStarttls: boolean; }

function jsonResp(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getSmtpSettings(): Promise<SmtpSettings | null> {
    const { data } = await supabase.from("platform_settings").select("key,value")
        .in("key", ["smtp_provider", "smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_from_email", "smtp_from_name", "smtp_use_starttls"]);
    const map: Record<string, unknown> = {};
    for (const row of (data ?? [])) map[row.key as string] = row.value;
    if ((map.smtp_provider ?? "disabled") === "disabled") return null;
    if (!map.smtp_host || !map.smtp_username || !map.smtp_password) return null;
    return {
        host: String(map.smtp_host), port: Number(map.smtp_port ?? 587),
        username: String(map.smtp_username), password: String(map.smtp_password),
        fromEmail: String(map.smtp_from_email ?? map.smtp_username),
        fromName:  String(map.smtp_from_name ?? "Mithras"),
        useStarttls: map.smtp_use_starttls !== false,
    };
}

function buildHtml(opts: { email: string; actionLink: string }): string {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
    <tr><td style="padding:28px 32px 8px;">
      <div style="color:#10b981;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Mithras</div>
      <h1 style="font-size:22px;margin:6px 0 16px;">Sign in to your account</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 18px;">Click below to sign in to <strong>${escapeHtml(opts.email)}</strong>. No password needed.</p>
      <p style="margin:0 0 18px;"><a href="${escapeHtml(opts.actionLink)}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Sign me in</a></p>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;margin:0 0 12px;">Link expires in 24 hours. If you didn't ask for this, ignore the message — your account stays untouched.</p>
    </td></tr>
    <tr><td style="padding:14px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:center;">Mithras Threat Defence · Australia.</td></tr>
  </table>
</td></tr></table></body></html>`;
}

function buildText(opts: { email: string; actionLink: string }): string {
    return [
        `Sign in to your Mithras account (${opts.email}).`, "",
        opts.actionLink, "",
        "Link expires in 24 hours. If you didn't ask for this, ignore.",
    ].join("\n");
}

async function sendStartTls(s: SmtpSettings, to: string, rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder(), dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read  = async () => { const n = await conn.read(buf); return n ? dec.decode(buf.subarray(0, n)) : ""; };
    const write = async (l: string) => { await conn.write(enc.encode(l + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); };
    await expect("220");
    await write(`EHLO mithras.com.au`); await expect("250");
    if (!s.useStarttls) { try { conn.close(); } catch {} throw new Error("non_tls_send_refused"); }
    await write("STARTTLS"); await expect("220");
    const tls = await Deno.startTls(conn, { hostname: s.host });
    const tEnc = new TextEncoder(), tDec = new TextDecoder();
    const tBuf = new Uint8Array(8192);
    const tRead  = async () => { const n = await tls.read(tBuf); return n ? tDec.decode(tBuf.subarray(0, n)) : ""; };
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

    let body: { email?: string } = {};
    try { body = await req.json(); } catch {}
    const email = String(body.email ?? "").trim().toLowerCase();
    // Hard-pinned, server-derived. Never accept a redirect target from the
    // client — see header comment for why.
    const redirectTo = `${SITE_URL}/account`;
    // Never leak account existence: silent OK for invalid emails.
    if (!isValidEmail(email)) return jsonResp({ ok: true }, 200, origin);

    // Generate the magic link via the admin API. Errors fall through to a
    // silent OK so callers can't probe for registered emails.
    let actionLink: string | null = null;
    try {
        const { data } = await supabase.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo },
        });
        actionLink = (data as any)?.properties?.action_link ?? null;
    } catch (e) {
        console.error("generateLink failed (likely no such user)", e);
    }

    if (!actionLink) return jsonResp({ ok: true }, 200, origin);

    const smtp = await getSmtpSettings();
    if (!smtp) {
        console.error("SMTP not configured; skipping send for", email);
        return jsonResp({ ok: true }, 200, origin);
    }

    const html = buildHtml({ email, actionLink });
    const text = buildText({ email, actionLink });
    // Disable SendGrid click tracking on auth links — Microsoft 365 Safe
    // Links and similar enterprise scanners pre-fetch wrapped URLs, which
    // consumes the single-use GoTrue magic link before the user clicks.
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
        `Subject: ${encodeHeader("Your Mithras sign-in link")}`,
        `MIME-Version: 1.0`,
        `X-SMTPAPI: ${sendgridDisableTracking}`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`, ``,
        text, ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`, ``,
        html, ``,
        `--${boundary}--`, ``,
    ].join("\r\n");
    try {
        await sendStartTls(smtp, email, rfcBody);
    } catch (e: any) {
        console.error("SMTP send failed:", e?.message);
    }
    return jsonResp({ ok: true }, 200, origin);
});
