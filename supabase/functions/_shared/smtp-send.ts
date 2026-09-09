// =============================================================================
// Shared SMTP send helper. Reads the platform_settings SMTP config and posts
// a single plaintext/HTML message via STARTTLS. Extracted from
// send-customer-report so the email-security functions can reuse it without
// pulling in the PDF-report machinery.
// =============================================================================

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeHeader, encodeHeader } from "./mime-safe.ts";

export interface SmtpSettings {
    host: string;
    port: number;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
    useStarttls: boolean;
}

export async function getSmtpSettings(supabase: SupabaseClient): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase
        .from("platform_settings")
        .select("key,value")
        .in("key", [
            "smtp_provider", "smtp_host", "smtp_port", "smtp_username",
            "smtp_password", "smtp_from_email", "smtp_from_name", "smtp_use_starttls",
        ]);
    const map: Record<string, unknown> = {};
    for (const row of (data ?? [])) map[(row as any).key as string] = (row as any).value;
    if ((map.smtp_provider ?? "disabled") === "disabled") return { error: "smtp_disabled" };
    if (!map.smtp_host || !map.smtp_username || !map.smtp_password) return { error: "smtp_not_configured" };
    return {
        host:        String(map.smtp_host),
        port:        Number(map.smtp_port ?? 587),
        username:    String(map.smtp_username),
        password:    String(map.smtp_password),
        fromEmail:   String(map.smtp_from_email ?? map.smtp_username),
        fromName:    String(map.smtp_from_name  ?? "Mithras"),
        useStarttls: map.smtp_use_starttls !== false,
    };
}

export interface SimpleMessage {
    to: string[];
    subject: string;
    htmlBody: string;
    textBody: string;
    replyTo?: string;
}

export function buildSimpleMime(s: SmtpSettings, msg: SimpleMessage): string {
    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    const fromName = encodeHeader(s.fromName);
    const fromEmail = sanitizeHeader(s.fromEmail);
    const subject  = encodeHeader(msg.subject);
    const toLine   = msg.to.map(sanitizeHeader).join(", ");
    const replyTo  = msg.replyTo ? sanitizeHeader(msg.replyTo) : null;

    const lines = [
        `From: ${fromName} <${fromEmail}>`,
        `To: ${toLine}`,
        ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        msg.textBody,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        msg.htmlBody,
        ``,
        `--${boundary}--`,
    ];
    return lines.join("\r\n");
}

export async function sendViaStarttls(s: SmtpSettings, recipients: string[], rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read   = async (): Promise<string> => { const n = await conn.read(buf); if (!n) return ""; return dec.decode(buf.subarray(0, n)); };
    const write  = async (line: string) => { await conn.write(enc.encode(line + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await expect("220");
    await write(`EHLO mithras.com.au`);
    await expect("250");
    if (!s.useStarttls) {
        try { conn.close(); } catch {/* */ }
        throw new Error("non_tls_send_refused");
    }
    await write("STARTTLS");
    await expect("220");
    const tls = await Deno.startTls(conn, { hostname: s.host });

    const tBuf = new Uint8Array(8192);
    const tRead   = async (): Promise<string> => { const n = await tls.read(tBuf); if (!n) return ""; return dec.decode(tBuf.subarray(0, n)); };
    const tWrite  = async (line: string) => { await tls.write(enc.encode(line + "\r\n")); };
    const tExpect = async (cp: string) => { const r = await tRead(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await tWrite(`EHLO mithras.com.au`);
    await tExpect("250");
    await tWrite("AUTH LOGIN");
    await tExpect("334");
    await tWrite(btoa(s.username));
    await tExpect("334");
    await tWrite(btoa(s.password));
    await tExpect("235");
    await tWrite(`MAIL FROM:<${s.fromEmail}>`);
    await tExpect("250");
    for (const rcpt of recipients) {
        await tWrite(`RCPT TO:<${rcpt}>`);
        await tExpect("250");
    }
    await tWrite("DATA");
    await tExpect("354");
    const safe = rfcBody.replace(/^\./gm, "..");
    await tls.write(enc.encode(safe + "\r\n.\r\n"));
    await tExpect("250");
    await tWrite("QUIT");
    try { tls.close(); } catch {/* */ }
}

/** One-shot helper: load settings, build MIME, send. Throws on error. */
export async function sendSimpleMail(supabase: SupabaseClient, msg: SimpleMessage): Promise<void> {
    const s = await getSmtpSettings(supabase);
    if ("error" in s) throw new Error(s.error);
    const rfc = buildSimpleMime(s, msg);
    await sendViaStarttls(s, msg.to, rfc);
}
