// POST /functions/v1/send-invoice-email
//
// Emails an invoice (HTML body, no attachment in v1) to the bill_to org's
// billing_email. Marks the invoice 'sent' and stamps sent_at on success.
//
// Auth: super-admin OR admin of the invoice's issuer org.
// Body: { invoice_id: uuid }

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

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getSmtpSettings(): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase
        .from("platform_settings").select("key,value")
        .in("key", ["smtp_provider","smtp_host","smtp_port","smtp_username","smtp_password","smtp_from_email","smtp_from_name","smtp_use_starttls"]);
    const map: Record<string, unknown> = {};
    for (const row of (data ?? [])) map[row.key as string] = row.value;
    if ((map.smtp_provider ?? "disabled") === "disabled") return { error: "smtp_disabled" };
    if (!map.smtp_host || !map.smtp_username || !map.smtp_password) return { error: "smtp_not_configured" };
    return {
        host: String(map.smtp_host), port: Number(map.smtp_port ?? 587),
        username: String(map.smtp_username), password: String(map.smtp_password),
        fromEmail: String(map.smtp_from_email ?? map.smtp_username),
        fromName:  String(map.smtp_from_name  ?? "Mithras"),
        useStarttls: map.smtp_use_starttls !== false,
    };
}

function fmtMoney(cents: number, currency: string): string {
    try {
        return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
    } catch {
        return `${(cents / 100).toFixed(2)} ${currency}`;
    }
}

function buildHtmlBody(opts: {
    invoiceNumber: string;
    issuerName: string;
    billToName: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    currency: string;
    subtotalCents: number;
    totalCents: number;
    lines: Array<{ description: string; quantity: number; unit_price_cents: number; line_total_cents: number }>;
    notes: string | null;
}): string {
    const lineRows = opts.lines.map(l => `
      <tr>
        <td style="padding:8px 12px;border-top:1px solid #e5e7eb;font-size:13px;">${escapeHtml(l.description)}</td>
        <td style="padding:8px 12px;border-top:1px solid #e5e7eb;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${l.quantity}</td>
        <td style="padding:8px 12px;border-top:1px solid #e5e7eb;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${fmtMoney(l.unit_price_cents, opts.currency)}</td>
        <td style="padding:8px 12px;border-top:1px solid #e5e7eb;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;font-weight:600;">${fmtMoney(l.line_total_cents, opts.currency)}</td>
      </tr>`).join("");

    return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0c0e;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <tr><td style="padding:24px 28px;background:linear-gradient(135deg,#1a1a1d 0%,#2a2a30 100%);">
        <div style="color:#D4A437;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Invoice</div>
        <div style="color:#fff;font-size:28px;font-weight:700;margin-top:4px;font-family:'SF Mono',Menlo,monospace;">${escapeHtml(opts.invoiceNumber)}</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:6px;">${escapeHtml(opts.issuerName)} → ${escapeHtml(opts.billToName)}</div>
      </td></tr>

      <tr><td style="padding:24px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Billing period</td>
            <td style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;text-align:right;">Due</td>
          </tr>
          <tr>
            <td style="font-size:14px;font-weight:500;">${opts.periodStart} → ${opts.periodEnd}</td>
            <td style="font-size:14px;font-weight:500;text-align:right;">${opts.dueDate}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th align="left"  style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Description</th>
            <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Qty</th>
            <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Unit</th>
            <th align="right" style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;background:#f9fafb;">Total</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
      </td></tr>

      <tr><td style="padding:24px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:2px solid #0b0c0e;padding-top:16px;">
          <tr><td style="font-size:18px;font-weight:700;padding-top:12px;">Total due</td>
              <td style="font-size:24px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;padding-top:12px;">${fmtMoney(opts.totalCents, opts.currency)}</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 28px 24px;font-size:13px;color:#4b5563;line-height:1.5;">
        <strong>Payment</strong><br>
        Pay via direct deposit using <strong>${escapeHtml(opts.invoiceNumber)}</strong> as the reference. Bank details are on file with your account manager — contact <a href="mailto:billing@mithras.com.au" style="color:#D4A437;">billing@mithras.com.au</a> if you need them resent.
        ${opts.notes ? `<br><br><strong>Notes</strong><br>${escapeHtml(opts.notes)}` : ""}
      </td></tr>

      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
        Mithras Threat Defence · Generated ${new Date().toISOString().slice(0,10)}<br>
        Questions? Reply to this email or contact billing@mithras.com.au.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildTextBody(opts: { invoiceNumber: string; issuerName: string; billToName: string; periodStart: string; periodEnd: string; dueDate: string; totalCents: number; currency: string; }): string {
    return [
        `Invoice ${opts.invoiceNumber}`,
        `From: ${opts.issuerName}`,
        `To:   ${opts.billToName}`,
        ``,
        `Period: ${opts.periodStart} to ${opts.periodEnd}`,
        `Due:    ${opts.dueDate}`,
        `Total:  ${fmtMoney(opts.totalCents, opts.currency)}`,
        ``,
        `Pay via direct deposit using ${opts.invoiceNumber} as the reference.`,
        `Bank details on file with your account manager.`,
        `Questions: billing@mithras.com.au`,
    ].join("\n");
}

function fmtMoneyText(cents: number, currency: string): string {
    return fmtMoney(cents, currency).replace(/[^\x20-\x7E]/g, "");
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
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    const isServiceCall = token === SUPABASE_SERVICE_KEY;
    let userId: string | null = null;
    let isSuper = false;
    if (!isServiceCall) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);
        userId = user.id;
        const { data: sa } = await supabase.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle();
        isSuper = !!sa;
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const invoiceId = String(body.invoice_id ?? "");
    if (!invoiceId) return jsonResponse({ error: "invoice_id_required" }, 400, origin);

    const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (!inv) return jsonResponse({ error: "invoice_not_found" }, 404, origin);

    // Non-super-admin must be admin of the issuer org.
    if (!isServiceCall && !isSuper && userId) {
        const { data: membership } = await supabase
            .from("organization_memberships").select("role")
            .eq("user_id", userId)
            .eq("organization_id", inv.issuer_org_id as string)
            .maybeSingle();
        if (!membership || !["owner","admin"].includes(String(membership.role))) {
            return jsonResponse({ error: "forbidden_admin_only" }, 403, origin);
        }
    }

    const [{ data: issuer }, { data: billTo }, { data: lines }] = await Promise.all([
        supabase.from("organizations").select("name,billing_email").eq("id", inv.issuer_org_id as string).maybeSingle(),
        supabase.from("organizations").select("name,billing_email").eq("id", inv.bill_to_org_id as string).maybeSingle(),
        supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).order("position"),
    ]);

    if (!billTo) return jsonResponse({ error: "bill_to_org_not_found" }, 404, origin);
    const recipient = String(billTo.billing_email ?? "").trim();
    if (!isValidEmail(recipient)) return jsonResponse({ error: "no_billing_email_on_file", details: "Add a billing email to the org under Admin → Channel partners." }, 400, origin);

    const smtp = await getSmtpSettings();
    if ("error" in smtp) return jsonResponse({ error: smtp.error }, 400, origin);

    const html = buildHtmlBody({
        invoiceNumber: String(inv.invoice_number),
        issuerName:    String(issuer?.name ?? "Mithras"),
        billToName:    String(billTo.name),
        periodStart:   String(inv.period_start),
        periodEnd:     String(inv.period_end),
        dueDate:       String(inv.due_date),
        currency:      String(inv.currency_code),
        subtotalCents: Number(inv.subtotal_cents),
        totalCents:    Number(inv.total_cents),
        lines:         (lines ?? []).map((l: any) => ({
            description: String(l.description),
            quantity:    Number(l.quantity),
            unit_price_cents: Number(l.unit_price_cents),
            line_total_cents: Number(l.line_total_cents),
        })),
        notes: inv.notes ? String(inv.notes) : null,
    });
    const text = buildTextBody({
        invoiceNumber: String(inv.invoice_number),
        issuerName:    String(issuer?.name ?? "Mithras"),
        billToName:    String(billTo.name),
        periodStart:   String(inv.period_start),
        periodEnd:     String(inv.period_end),
        dueDate:       String(inv.due_date),
        totalCents:    Number(inv.total_cents),
        currency:      String(inv.currency_code),
    });

    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    const rfcBody = [
        `From: ${encodeHeader(smtp.fromName)} <${sanitizeHeader(smtp.fromEmail)}>`,
        `To: ${sanitizeHeader(recipient)}`,
        `Subject: ${encodeHeader(`Invoice ${inv.invoice_number} — ${fmtMoneyText(Number(inv.total_cents), String(inv.currency_code))} due ${inv.due_date}`)}`,
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
        await sendStartTls(smtp, recipient, rfcBody);
    } catch (e: any) {
        return jsonResponse({ error: "smtp_send_failed", details: e?.message }, 502, origin);
    }

    await supabase.from("invoices").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    } as any).eq("id", invoiceId);

    return jsonResponse({ ok: true, sent_to: recipient }, 200, origin);
});
