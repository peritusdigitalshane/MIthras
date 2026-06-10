// POST /functions/v1/smtp-settings
// Super-admin only. Manages SMTP / Microsoft 365 mail integration settings
// stored in platform_settings.
//
// Body actions:
//   { action: "get" }    → returns current settings (password is redacted)
//   { action: "save", settings: {...} }   → upserts settings; password only
//                                             overwritten if non-empty
//   { action: "test", to: string }        → sends a test email using whatever
//                                             is currently saved
//
// Storage keys in platform_settings:
//   smtp_provider     ("disabled" | "m365" | "custom")
//   smtp_host         (string)
//   smtp_port         (number)
//   smtp_username     (string — usually the from address for m365)
//   smtp_password     (string — app password or smtp password)
//   smtp_from_email   (string)
//   smtp_from_name    (string)
//   smtp_use_starttls (boolean, default true)
//
// NOTE: GoTrue reads its SMTP env vars at container startup. Saving here
// stores the settings in the DB; applying them to GoTrue requires editing
// the compose env file and restarting the auth container. That step is
// intentionally NOT automated because it requires root on the VM and we
// don't grant the function shell access. A follow-up runbook on the
// platform handles the apply step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

const KEYS = [
    "smtp_provider", "smtp_host", "smtp_port", "smtp_username",
    "smtp_password", "smtp_from_email", "smtp_from_name", "smtp_use_starttls",
];

async function getAllSettings(): Promise<Record<string, unknown>> {
    const { data } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", KEYS);
    const out: Record<string, unknown> = {};
    for (const row of (data ?? [])) {
        const k = row.key as string;
        const v = row.value;
        // platform_settings.value is jsonb — already parsed by supabase-js.
        out[k] = v;
    }
    // Defaults for new installs.
    if (!out.smtp_provider) out.smtp_provider = "disabled";
    if (!out.smtp_host && out.smtp_provider === "m365") out.smtp_host = "smtp.office365.com";
    if (!out.smtp_port) out.smtp_port = 587;
    if (out.smtp_use_starttls === undefined) out.smtp_use_starttls = true;
    return out;
}

async function saveSettings(settings: Record<string, unknown>) {
    const upserts: Array<{ key: string; value: unknown }> = [];
    for (const k of KEYS) {
        if (k in settings) {
            // smtp_password: empty string means "leave whatever's stored unchanged".
            if (k === "smtp_password" && (settings[k] === "" || settings[k] === null || settings[k] === undefined)) continue;
            upserts.push({ key: k, value: settings[k] });
        }
    }
    if (upserts.length > 0) {
        const { error } = await supabase.from("platform_settings").upsert(upserts, { onConflict: "key" });
        if (error) throw new Error(error.message);
    }
}

// Minimal SMTP STARTTLS client for a connectivity test. We do NOT use this
// for actual recovery emails — GoTrue handles those — this is solely to
// validate the credentials the operator just entered.
async function sendTestEmail(opts: {
    host: string; port: number; username: string; password: string;
    fromEmail: string; fromName: string; to: string; useStarttls: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        const conn = await Deno.connect({ hostname: opts.host, port: opts.port });
        const enc = new TextEncoder(); const dec = new TextDecoder();
        const buf = new Uint8Array(8192);

        const read = async () => {
            const n = await conn.read(buf);
            if (!n) return "";
            return dec.decode(buf.subarray(0, n));
        };
        const write = async (s: string) => { await conn.write(enc.encode(s + "\r\n")); };

        const expect = async (codePrefix: string) => {
            const r = await read();
            if (!r.startsWith(codePrefix)) throw new Error(`expected ${codePrefix}, got: ${r.trim()}`);
            return r;
        };

        await expect("220");
        await write(`EHLO mithras.com.au`);
        await expect("250");

        if (opts.useStarttls) {
            await write("STARTTLS");
            await expect("220");
            // Upgrade socket to TLS
            const tls = await Deno.startTls(conn, { hostname: opts.host });
            // Replace conn references (close not awaited here — tls finalises both)
            const tlsEnc = new TextEncoder(); const tlsDec = new TextDecoder();
            const tlsBuf = new Uint8Array(8192);
            const tlsRead = async () => { const n = await tls.read(tlsBuf); if (!n) return ""; return tlsDec.decode(tlsBuf.subarray(0, n)); };
            const tlsWrite = async (s: string) => { await tls.write(tlsEnc.encode(s + "\r\n")); };
            const tlsExpect = async (cp: string) => { const r = await tlsRead(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };
            await tlsWrite(`EHLO mithras.com.au`); await tlsExpect("250");
            await tlsWrite("AUTH LOGIN"); await tlsExpect("334");
            await tlsWrite(btoa(opts.username)); await tlsExpect("334");
            await tlsWrite(btoa(opts.password)); await tlsExpect("235");
            await tlsWrite(`MAIL FROM:<${opts.fromEmail}>`); await tlsExpect("250");
            await tlsWrite(`RCPT TO:<${opts.to}>`); await tlsExpect("250");
            await tlsWrite("DATA"); await tlsExpect("354");
            const body =
                `From: ${opts.fromName} <${opts.fromEmail}>\r\n` +
                `To: ${opts.to}\r\n` +
                `Subject: Mithras SMTP test\r\n` +
                `MIME-Version: 1.0\r\n` +
                `Content-Type: text/plain; charset=utf-8\r\n` +
                `\r\n` +
                `This is a test email from the Mithras Threat Defence platform.\r\n` +
                `If you received this, your SMTP settings are working.\r\n` +
                `.`;
            await tlsWrite(body); await tlsExpect("250");
            await tlsWrite("QUIT");
            try { tls.close(); } catch {}
            return { ok: true };
        }
        // Non-TLS path intentionally unimplemented (refuse to send creds in clear).
        try { conn.close(); } catch {}
        return { ok: false, error: "non_tls_send_refused" };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Test action sends an SMTP email; protect against burning the M365 budget.
    const rl = checkRateLimit(req, "smtp-settings", { max: 20, windowMs: 60_000 });
    if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    // Super-admin only.
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isSuper) return jsonResponse({ error: "forbidden_super_admin_only" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const action = String(body.action ?? "");

    if (action === "get") {
        const settings = await getAllSettings();
        // Redact password — present as "" so the UI knows there's something
        // saved without leaking it.
        if (settings.smtp_password) settings.smtp_password = "__redacted__";
        return jsonResponse({ ok: true, settings }, 200, origin);
    }

    if (action === "save") {
        const settings = (body.settings as Record<string, unknown>) ?? {};
        // Strip the redacted sentinel so we don't overwrite the real value with it.
        if (settings.smtp_password === "__redacted__") delete settings.smtp_password;
        try {
            await saveSettings(settings);
            return jsonResponse({ ok: true, note: "Saved. To apply to outgoing emails, the platform operator must restart the auth container after wiring these into the GoTrue env." }, 200, origin);
        } catch (e) {
            return jsonResponse({ error: "save_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
        }
    }

    if (action === "test") {
        const to = String(body.to ?? "").trim();
        if (!to) return jsonResponse({ error: "to_required" }, 400, origin);
        const s = await getAllSettings();
        if (s.smtp_provider === "disabled") return jsonResponse({ error: "smtp_disabled" }, 400, origin);
        if (!s.smtp_host || !s.smtp_username || !s.smtp_password) {
            return jsonResponse({ error: "smtp_not_configured" }, 400, origin);
        }
        const r = await sendTestEmail({
            host:        String(s.smtp_host),
            port:        Number(s.smtp_port ?? 587),
            username:    String(s.smtp_username),
            password:    String(s.smtp_password),
            fromEmail:   String(s.smtp_from_email ?? s.smtp_username),
            fromName:    String(s.smtp_from_name ?? "Mithras"),
            to,
            useStarttls: s.smtp_use_starttls !== false,
        });
        return jsonResponse(r, r.ok ? 200 : 502, origin);
    }

    return jsonResponse({ error: "invalid_action" }, 400, origin);
});
