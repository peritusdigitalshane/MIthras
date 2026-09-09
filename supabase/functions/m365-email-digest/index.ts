// =============================================================================
// /functions/v1/m365-email-digest
//
// Once-daily summary email to org admins of every customer with active
// email_security detections. Sends one row to email_digest_runs per org per
// day; the unique constraint stops double-sends.
//
// Triggered by pg_cron 07:00 UTC.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSimpleMail } from "../_shared/smtp-send.ts";
import { escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface OrgRow { id: string; name: string }
interface ThreatRow {
    classification: string; severity: string; sender_email: string | null;
    recipient_email: string; subject: string | null; received_at: string;
}

function digestBody(orgName: string, threats: ThreatRow[], dateLabel: string): { subject: string; html: string; text: string } {
    const counts = { phishing: 0, bec: 0, malware: 0, spam: 0, suspicious: 0 };
    for (const t of threats) {
        if (t.classification in counts) (counts as any)[t.classification]++;
    }
    const topRows = threats.slice(0, 15);
    const subject = `Mithras email security — ${threats.length} flagged in last 24h (${orgName})`;

    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7fb;margin:0;padding:24px;color:#111">
<div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <div style="background:#0f172a;color:#fff;padding:18px 22px"><div style="font-size:13px;opacity:.7">Email security daily digest</div><div style="font-size:18px;font-weight:600">${escapeHtml(orgName)} — ${dateLabel}</div></div>
  <div style="padding:20px;font-size:14px;line-height:1.5">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <span style="background:#fee2e2;color:#991b1b;padding:6px 10px;border-radius:8px;font-size:13px">Phishing <b>${counts.phishing}</b></span>
      <span style="background:#fee2e2;color:#991b1b;padding:6px 10px;border-radius:8px;font-size:13px">BEC <b>${counts.bec}</b></span>
      <span style="background:#fee2e2;color:#991b1b;padding:6px 10px;border-radius:8px;font-size:13px">Malware <b>${counts.malware}</b></span>
      <span style="background:#f3f4f6;color:#374151;padding:6px 10px;border-radius:8px;font-size:13px">Suspicious <b>${counts.suspicious}</b></span>
      <span style="background:#f3f4f6;color:#374151;padding:6px 10px;border-radius:8px;font-size:13px">Spam <b>${counts.spam}</b></span>
    </div>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="text-align:left;border-bottom:1px solid #e5e7eb">
        <th style="padding:8px 6px">Class</th><th style="padding:8px 6px">From</th><th style="padding:8px 6px">To</th><th style="padding:8px 6px">Subject</th>
      </tr></thead>
      <tbody>
        ${topRows.map(r => `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:6px;color:#dc2626;font-weight:600">${escapeHtml(r.classification)}</td><td style="padding:6px">${escapeHtml(r.sender_email ?? "")}</td><td style="padding:6px">${escapeHtml(r.recipient_email)}</td><td style="padding:6px">${escapeHtml((r.subject ?? "").slice(0, 80))}</td></tr>`).join("")}
      </tbody>
    </table>
    ${threats.length > topRows.length ? `<p style="color:#6b7280;margin-top:12px;font-size:12px">+ ${threats.length - topRows.length} more not shown. See the full list in the console.</p>` : ""}
    <p style="margin-top:18px"><a href="${SITE_URL}/email-security" style="background:#0ea5e9;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Open email security console</a></p>
  </div>
  <div style="background:#f9fafb;padding:12px 20px;font-size:11px;color:#6b7280">Mithras Threat Defence · Daily digest</div>
</div></body></html>`;

    const text = `Mithras email security — ${orgName} — ${dateLabel}
Flagged in last 24h: ${threats.length}
Phishing ${counts.phishing} · BEC ${counts.bec} · Malware ${counts.malware} · Suspicious ${counts.suspicious} · Spam ${counts.spam}

Top: ${topRows.map(r => `[${r.classification}] ${r.sender_email ?? ""} -> ${r.recipient_email}: ${r.subject ?? ""}`).join("\n  ")}

Console: ${SITE_URL}/email-security`;

    return { subject, html, text };
}

async function processOrg(org: OrgRow, todayLabel: string, todayDate: string, stats: { sent: number; skipped_no_threats: number; skipped_no_recipients: number; skipped_dupe: number; errors: number }): Promise<void> {
    // Skip if we already sent today's digest for this org.
    const { data: existing } = await supabase
        .from("email_digest_runs")
        .select("id")
        .eq("organization_id", org.id)
        .eq("digest_for_date", todayDate)
        .maybeSingle();
    if (existing) { stats.skipped_dupe++; return; }

    // Threats received in the last 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: threats } = await supabase
        .from("email_threats")
        .select("classification, severity, sender_email, recipient_email, subject, received_at")
        .eq("organization_id", org.id)
        .gte("received_at", since)
        .neq("classification", "legitimate")
        .order("received_at", { ascending: false })
        .limit(500);
    if (!threats || threats.length === 0) { stats.skipped_no_threats++; return; }

    // Recipients: org_report_recipients with role admin/owner OR explicit
    // org_alert_recipients. We reuse the latter pattern when present.
    const { data: alertRecipients } = await supabase
        .from("org_alert_recipients")
        .select("email")
        .eq("organization_id", org.id);
    const recipients = (alertRecipients ?? [])
        .map(r => (r as any).email as string)
        .filter(Boolean);
    if (recipients.length === 0) { stats.skipped_no_recipients++; return; }

    const { subject, html, text } = digestBody(org.name, threats as ThreatRow[], todayLabel);
    try {
        await sendSimpleMail(supabase, { to: recipients, subject, htmlBody: html, textBody: text });
        await supabase.from("email_digest_runs").insert({
            organization_id: org.id,
            digest_for_date: todayDate,
            threats_in_period: threats.length,
            recipients,
        } as any);
        stats.sent++;
    } catch (e: any) {
        stats.errors++;
        console.error(`digest send failed for ${org.id}:`, e?.message);
    }
}

Deno.serve(async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.replace(/^Bearer\s+/i, "").trim() !== SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const todayLabel = now.toUTCString().slice(0, 16); // "Mon, 15 Jun 2026"

    const stats = { sent: 0, skipped_no_threats: 0, skipped_no_recipients: 0, skipped_dupe: 0, errors: 0, orgs: 0 };

    // Every org that has at least one email_threats row in the last 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: orgIds } = await supabase
        .from("email_threats")
        .select("organization_id")
        .gte("received_at", since);
    const distinctIds = Array.from(new Set((orgIds ?? []).map(r => r.organization_id as string)));
    if (distinctIds.length === 0) {
        return new Response(JSON.stringify({ ok: true, ...stats }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", distinctIds)
        .eq("is_active", true);
    stats.orgs = (orgs ?? []).length;

    for (const org of (orgs ?? []) as OrgRow[]) {
        try { await processOrg(org, todayLabel, todayDate, stats); }
        catch (e: any) { stats.errors++; console.error("digest org failed:", e?.message); }
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), { status: 200, headers: { "content-type": "application/json" } });
});
