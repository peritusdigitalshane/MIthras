// POST /functions/v1/send-customer-report
//
// Emails a finished customer_reports row as a PDF attachment to every
// org_report_recipients address flagged for that report's kind. Uses the
// platform-wide SMTP settings stored in platform_settings (same as the
// smtp-settings function — single source of truth).
//
// Auth:
//   - Service-role bearer (used by generate-customer-report's auto-send hook
//     and by pg_cron)
//   - Super-admin user JWT (used by the SOC operator's "Send" button)
//   - Org admin user JWT, scoped to a report belonging to their org
//
// Body: { report_id: uuid }
// Response: { ok: true, sent_to: [...] } on success, { error, details } on failure

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const REPORTS_BUCKET       = "customer-reports";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// Move a row out of the retry-send cron's eligibility window. Called for
// terminal failures (missing PDF, no recipients) so the cron stops cycling
// rows that need operator intervention rather than another transient retry.
async function markReportFailed(reportId: string, reason: string): Promise<void> {
    await supabase.from("customer_reports").update({
        status:          "failed",
        last_send_error: reason,
    }).eq("id", reportId);
}

interface SmtpSettings {
    host: string;
    port: number;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
    useStarttls: boolean;
}

async function getSmtpSettings(): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase
        .from("platform_settings")
        .select("key,value")
        .in("key", [
            "smtp_provider", "smtp_host", "smtp_port", "smtp_username",
            "smtp_password", "smtp_from_email", "smtp_from_name", "smtp_use_starttls",
        ]);
    const map: Record<string, unknown> = {};
    for (const row of (data ?? [])) {
        map[row.key as string] = row.value;
    }
    if ((map.smtp_provider ?? "disabled") === "disabled") {
        return { error: "smtp_disabled" };
    }
    if (!map.smtp_host || !map.smtp_username || !map.smtp_password) {
        return { error: "smtp_not_configured" };
    }
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

// Build a multipart/mixed message with the PDF attached. Returns the raw RFC5322
// body — caller wraps DATA / "." termination.
function buildMimeBody(opts: {
    fromEmail: string; fromName: string;
    to: string[]; subject: string;
    htmlBody: string; textBody: string;
    pdfBytes: Uint8Array; pdfFilename: string;
}): string {
    const boundaryMixed = `mixed-${crypto.randomUUID().replace(/-/g, "")}`;
    const boundaryAlt   = `alt-${crypto.randomUUID().replace(/-/g, "")}`;

    const pdfB64 = base64(opts.pdfBytes);
    // Wrap base64 to 76 cols per RFC 2045.
    const pdfWrapped = pdfB64.replace(/(.{76})/g, "$1\r\n");

    // Every dynamic value in a header line gets sanitized first. CR/LF in
    // any of these would let the caller smuggle additional headers, an
    // extra Bcc:, or — at worst — break the MIME envelope and inject SMTP
    // commands once the body crosses DATA. We also RFC-2047-encode the
    // friendly bits (fromName, subject, filename) so non-ASCII bytes
    // round-trip cleanly across the wire.
    const fromName = encodeHeader(opts.fromName);
    const fromEmail = sanitizeHeader(opts.fromEmail);
    const subject  = encodeHeader(opts.subject);
    const filename = encodeHeader(opts.pdfFilename);
    const toLine   = opts.to.map(sanitizeHeader).join(", ");

    return [
        `From: ${fromName} <${fromEmail}>`,
        `To: ${toLine}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
        ``,
        `--${boundaryMixed}`,
        `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
        ``,
        `--${boundaryAlt}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        opts.textBody,
        ``,
        `--${boundaryAlt}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        opts.htmlBody,
        ``,
        `--${boundaryAlt}--`,
        ``,
        `--${boundaryMixed}`,
        `Content-Type: application/pdf; name="${filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${filename}"`,
        ``,
        pdfWrapped,
        ``,
        `--${boundaryMixed}--`,
    ].join("\r\n");
}

function base64(bytes: Uint8Array): string {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(s);
}

// SMTP STARTTLS conversation. Mirrors the helper in smtp-settings but for a
// multi-recipient message with an attachment.
async function sendViaStarttls(s: SmtpSettings, recipients: string[], rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const buf = new Uint8Array(8192);

    const read = async (): Promise<string> => {
        const n = await conn.read(buf);
        if (!n) return "";
        return dec.decode(buf.subarray(0, n));
    };
    const write = async (line: string) => { await conn.write(enc.encode(line + "\r\n")); };
    const expect = async (codePrefix: string) => {
        const r = await read();
        if (!r.startsWith(codePrefix)) throw new Error(`expected ${codePrefix}, got: ${r.trim()}`);
        return r;
    };

    await expect("220");
    await write(`EHLO mithras.com.au`);
    await expect("250");

    if (!s.useStarttls) {
        try { conn.close(); } catch { /* ignore */ }
        throw new Error("non_tls_send_refused");
    }
    await write("STARTTLS");
    await expect("220");
    const tls = await Deno.startTls(conn, { hostname: s.host });

    const tlsEnc = new TextEncoder();
    const tlsDec = new TextDecoder();
    const tlsBuf = new Uint8Array(8192);
    const tRead   = async (): Promise<string> => { const n = await tls.read(tlsBuf); if (!n) return ""; return tlsDec.decode(tlsBuf.subarray(0, n)); };
    const tWrite  = async (line: string) => { await tls.write(tlsEnc.encode(line + "\r\n")); };
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

    // RFC 5321 §4.5.2: lines starting with "." must be dot-stuffed.
    const safe = rfcBody.replace(/^\./gm, "..");
    await tls.write(tlsEnc.encode(safe + "\r\n.\r\n"));
    await tExpect("250");
    await tWrite("QUIT");

    try { tls.close(); } catch { /* socket already closed by QUIT */ }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Apply rate limit only to user-callable invocations. The service-role
    // call (used by auto-send from generate-customer-report) bypasses since
    // it's already constrained by the customer_reports queue throughput.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    const isServiceCall = token === SUPABASE_SERVICE_KEY;
    if (!isServiceCall) {
        const rl = checkRateLimit(req, "send-customer-report", { max: 20, windowMs: 60_000 });
        if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);
    }
    let userId: string | null = null;
    let isSuper = false;

    if (!isServiceCall) {
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);
        userId = user.id;
        const { data: sa } = await supabase
            .from("super_admins").select("user_id").eq("user_id", userId).maybeSingle();
        isSuper = !!sa;
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }
    const reportId = String(body.report_id ?? "");
    if (!reportId) return jsonResponse({ error: "report_id_required" }, 400, origin);

    const { data: report, error: rErr } = await supabase
        .from("customer_reports").select("*").eq("id", reportId).maybeSingle();
    if (rErr || !report) return jsonResponse({ error: "report_not_found", details: rErr?.message }, 404, origin);

    // Non-super-admin user must be admin of the report's org.
    if (!isServiceCall && !isSuper && userId) {
        const { data: membership } = await supabase
            .from("organization_memberships")
            .select("role")
            .eq("user_id", userId)
            .eq("organization_id", report.organization_id as string)
            .maybeSingle();
        if (!membership || !["owner", "admin"].includes(String(membership.role))) {
            return jsonResponse({ error: "forbidden_admin_only" }, 403, origin);
        }
    }

    if (report.status !== "ready" && report.status !== "sent") {
        return jsonResponse({ error: "report_not_ready", status: report.status }, 409, origin);
    }
    if (!report.pdf_storage_path) {
        // Terminal — generate-customer-report never wrote the PDF. Mark the
        // row failed so the retry-send cron stops cycling it.
        await markReportFailed(reportId, "report_pdf_missing");
        return jsonResponse({ error: "report_pdf_missing" }, 409, origin);
    }

    // Pull org name + recipients in parallel with the PDF download.
    const [orgRes, recipRes, pdfDl] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", report.organization_id).maybeSingle(),
        supabase.from("org_report_recipients").select("email,name,monthly,weekly,quarterly")
            .eq("organization_id", report.organization_id as string),
        supabase.storage.from(REPORTS_BUCKET).download(String(report.pdf_storage_path)),
    ]);

    if (orgRes.error || !orgRes.data) {
        return jsonResponse({ error: "org_lookup_failed", details: orgRes.error?.message }, 500, origin);
    }
    if (recipRes.error) {
        return jsonResponse({ error: "recipients_lookup_failed", details: recipRes.error.message }, 500, origin);
    }
    if (pdfDl.error || !pdfDl.data) {
        return jsonResponse({ error: "pdf_download_failed", details: pdfDl.error?.message }, 500, origin);
    }

    const orgName = orgRes.data.name as string;
    const kind    = String(report.kind);

    // Filter recipients by what they've opted into for this kind.
    const kindKey = kind === "weekly" ? "weekly" : kind === "quarterly" ? "quarterly" : "monthly";
    const recipients = (recipRes.data ?? []).filter((r: Record<string, unknown>) => Boolean(r[kindKey]));
    if (recipients.length === 0) {
        // Terminal — the org has no one subscribed to this report kind. Mark
        // failed so the retry cron skips it; admin can add a recipient and
        // re-trigger via the dashboard "Send" button.
        await markReportFailed(reportId, "no_recipients_for_kind:" + kind);
        return jsonResponse({ error: "no_recipients_for_kind", kind }, 409, origin);
    }
    // Validate every recipient address before passing it to RCPT TO: or the
    // header line. An attacker who can set org_report_recipients.email could
    // otherwise inject CR/LF to add a bcc or break the SMTP envelope.
    const emails = recipients
        .map((r: Record<string, unknown>) => String(r.email).trim().toLowerCase())
        .filter((e) => isValidEmail(e));
    if (emails.length === 0) {
        // Terminal — every recipient email failed format validation.
        await markReportFailed(reportId, "no_valid_recipient_emails:" + kind);
        return jsonResponse({ error: "no_valid_recipient_emails", kind }, 409, origin);
    }

    const smtp = await getSmtpSettings();
    if ("error" in smtp) {
        return jsonResponse({ error: smtp.error }, 400, origin);
    }

    const pdfBytes = new Uint8Array(await pdfDl.data.arrayBuffer());
    const periodStart = new Date(String(report.period_start));
    const periodEnd   = new Date(String(report.period_end));
    const periodLabel = `${periodStart.toLocaleDateString("en-AU")} – ${periodEnd.toLocaleDateString("en-AU")}`;
    // Filename uses the org name → sanitize before it lands in
    // Content-Disposition. Also collapse runs of non-word chars.
    const safeOrgSlug = sanitizeHeader(orgName).replace(/[^\w-]+/g, "_");
    const filename = `${safeOrgSlug}-${kind}-${periodStart.toISOString().slice(0,10)}.pdf`;

    // Subject + body interpolate orgName / kind / periodLabel. The header
    // gets RFC-2047 encoded inside buildMimeBody; the HTML body needs us to
    // escape the same values so a malicious orgName can't smuggle markup.
    const subject  = `${orgName} ${kind} security report — ${periodLabel}`;
    const textBody =
`Hi,

Your ${kind} Mithras security report for ${orgName} is attached.

Period: ${periodLabel}

If you have any questions, reply to this email.

— Mithras Threat Defence`;
    const htmlBody = `<!doctype html><html><body style="font-family:Segoe UI,Roboto,sans-serif;color:#0f172a">
<p>Hi,</p>
<p>Your <strong>${escapeHtml(kind)}</strong> Mithras security report for <strong>${escapeHtml(orgName)}</strong> is attached.</p>
<p><strong>Period:</strong> ${escapeHtml(periodLabel)}</p>
<p>If you have any questions, reply to this email.</p>
<p style="color:#64748b">— Mithras Threat Defence · <a href="${escapeHtml(SITE_URL)}">${escapeHtml(SITE_URL)}</a></p>
</body></html>`;

    const mime = buildMimeBody({
        fromEmail: smtp.fromEmail,
        fromName:  smtp.fromName,
        to:        emails,
        subject,
        textBody,
        htmlBody,
        pdfBytes,
        pdfFilename: filename,
    });

    try {
        await sendViaStarttls(smtp, emails, mime);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("customer_reports").update({
            last_send_error: msg,
        }).eq("id", reportId);
        return jsonResponse({ error: "smtp_send_failed", details: msg }, 502, origin);
    }

    await supabase.from("customer_reports").update({
        status:        "sent",
        sent_at:       new Date().toISOString(),
        delivered_to:  emails,
        last_send_error: null,
    }).eq("id", reportId);

    return jsonResponse({ ok: true, sent_to: emails }, 200, origin);
});
