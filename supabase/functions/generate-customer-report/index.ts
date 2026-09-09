// POST /functions/v1/generate-customer-report
//
// Picks up to N rows from customer_reports where status='queued', builds an
// HTML summary using build_org_period_summary, writes it to the customer-reports
// storage bucket, marks the row ready, and (best-effort) emails the link to
// every org admin / customer-admin user of that org.
//
// Trigger via:
//   - Manual: super-admin calls this with { kind, period_start, period_end, org_id? }
//   - Scheduled: pg_cron enqueues weekly/monthly rows; a separate cron job (or
//     this function called by an external scheduler) processes them.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { buildReportPdf } from "./pdf.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Edge functions live under /functions/v1/ on every supabase deploy. Neither
// SUPABASE_URL (e.g. http://kong:8000) nor the prod PUBLIC_API_BASE_URL
// (e.g. https://api.mithras.com.au) include that prefix, so always normalise
// the base and tack the prefix on ourselves. Without this the internal
// generate→send hop 401s because Kong doesn't recognise the bare path.
const PUBLIC_API_BASE = (() => {
    const raw = (Deno.env.get("PUBLIC_API_BASE_URL") ?? SUPABASE_URL).replace(/\/+$/, "");
    return raw.endsWith("/functions/v1") ? raw : `${raw}/functions/v1`;
})();
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const REPORTS_BUCKET       = "customer-reports";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

function htmlEscape(s: unknown): string {
    return String(s ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

async function getOpenAiKey(): Promise<string | null> {
    const env = Deno.env.get("OPENAI_API_KEY");
    if (env) return env;
    try {
        const { data } = await supabase.from("platform_settings").select("value").eq("key", "openai_api_key").maybeSingle();
        return (data?.value as string) ?? null;
    } catch { return null; }
}

async function getOpenAiModel(): Promise<string> {
    const env = Deno.env.get("OPENAI_MODEL");
    if (env) return env;
    try {
        const { data } = await supabase.from("platform_settings").select("value").eq("key", "openai_model").maybeSingle();
        const v = (data?.value as string | undefined)?.trim();
        if (v) return v;
    } catch { /* fall through */ }
    return "gpt-4o-mini";
}

async function generateExecSummary(orgName: string, summary: Record<string, unknown>, kind: string): Promise<string | null> {
    const key = await getOpenAiKey();
    if (!key) return null;
    const model = await getOpenAiModel();
    const supportsTemperature = !/^o1|^o4|^gpt-5/.test(model);
    const body: Record<string, unknown> = {
        model,
        max_tokens: 250,
        messages: [
            { role: "system", content: "You are a friendly MSP security analyst writing the opening paragraph of a customer's weekly/monthly security report. Tone: confident, non-alarmist, scannable for a non-technical reader. 3-5 short sentences. No markdown, no bullet lists, no headings. Lead with what happened, then what to do." },
            { role: "user", content: `Write the exec summary for this period.

Customer: ${orgName}
Report kind: ${kind}
Period: ${summary.period_start} -> ${summary.period_end}

Metrics:
- Endpoints total / online now: ${summary.endpoints_total} / ${summary.endpoints_online}
- Threats detected this period: ${summary.threats_in_period} (Severe: ${summary.threats_severe})
- Incidents opened / resolved / still open: ${summary.incidents_opened} / ${summary.incidents_resolved} / ${summary.incidents_open_now}
- Vulnerabilities open / critical: ${summary.vulns_open} / ${summary.vulns_critical}

Top 3 incidents (if any): ${JSON.stringify((summary.top_incidents as Array<Record<string, unknown>> ?? []).slice(0, 3))}` },
        ],
    };
    if (supportsTemperature) body.temperature = 0.4;
    try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) return null;
        const raw = await resp.json();
        return raw?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch { return null; }
}

// AU date fmt: "8 Jun 2026" — readable in monthly customer reports.
const _dateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });
const fmtDate = (d: string | Date) => _dateFmt.format(new Date(d));

function renderReport(orgName: string, summary: Record<string, unknown>, kind: string, execSummary: string | null): string {
    const fmt = (n: unknown) => htmlEscape(n ?? 0);
    const start = fmtDate(String(summary.period_start));
    const end   = fmtDate(String(summary.period_end));
    const topIncidents = Array.isArray(summary.top_incidents) ? summary.top_incidents as Array<Record<string, unknown>> : [];
    const topSoftware  = Array.isArray(summary.top_software)  ? summary.top_software  as Array<Record<string, unknown>> : [];

    const execSection = execSummary
      ? `<div class="exec"><div class="exec-label">AI executive summary</div><p>${htmlEscape(execSummary)}</p></div>`
      : "";
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>${htmlEscape(orgName)} - ${htmlEscape(kind)} security report</title>
<style>
 body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:#0f172a; max-width: 880px; margin: 32px auto; padding: 0 24px; line-height:1.5; }
 h1 { color:#00C4AB; letter-spacing:.04em; margin:0 0 4px 0; }
 .sub { color:#64748b; margin-bottom: 28px; }
 .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; margin: 24px 0; }
 .card { border:1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
 .card .label { color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
 .card .value { font-size:28px; font-weight:700; margin-top:4px; color:#0f172a; }
 .card.alert .value { color:#dc2626; }
 .card.good  .value { color:#059669; }
 table { width:100%; border-collapse: collapse; margin: 12px 0 28px 0; }
 th, td { text-align:left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size:14px; }
 th { background:#f8fafc; color:#475569; font-weight:600; }
 .sev-Severe { color:#dc2626; font-weight:600; }
 .sev-High   { color:#ea580c; font-weight:600; }
 .sev-Moderate { color:#ca8a04; }
 .footer { color:#94a3b8; font-size:12px; margin-top:48px; border-top:1px solid #e2e8f0; padding-top:16px; }
 .exec { background:#f0fdfa; border:1px solid #00C4AB33; border-left:4px solid #00C4AB; border-radius:8px; padding:16px 20px; margin:24px 0; }
 .exec-label { color:#00897B; font-size:11px; text-transform:uppercase; letter-spacing:.10em; font-weight:700; margin-bottom:6px; }
 .exec p { margin:0; color:#0f172a; font-size:14px; line-height:1.6; }
</style></head>
<body>
<h1>MITHRAS</h1>
<div class="sub">${htmlEscape(orgName)} &middot; ${htmlEscape(kind)} security report &middot; ${start} - ${end}</div>

${execSection}

<div class="grid">
 <div class="card"><div class="label">Endpoints</div><div class="value">${fmt(summary.endpoints_total)}</div></div>
 <div class="card good"><div class="label">Online now</div><div class="value">${fmt(summary.endpoints_online)}</div></div>
 <div class="card ${Number(summary.threats_in_period) > 0 ? "alert" : "good"}"><div class="label">Threats this period</div><div class="value">${fmt(summary.threats_in_period)}</div></div>
 <div class="card ${Number(summary.threats_severe) > 0 ? "alert" : "good"}"><div class="label">Severe threats</div><div class="value">${fmt(summary.threats_severe)}</div></div>

 <div class="card"><div class="label">Incidents opened</div><div class="value">${fmt(summary.incidents_opened)}</div></div>
 <div class="card good"><div class="label">Incidents resolved</div><div class="value">${fmt(summary.incidents_resolved)}</div></div>
 <div class="card ${Number(summary.incidents_open_now) > 0 ? "alert" : "good"}"><div class="label">Open right now</div><div class="value">${fmt(summary.incidents_open_now)}</div></div>
 <div class="card ${Number(summary.vulns_critical) > 0 ? "alert" : ""}"><div class="label">Critical vulns</div><div class="value">${fmt(summary.vulns_critical)}</div></div>
</div>

<h3>Incidents this period</h3>
${topIncidents.length === 0
    ? "<p style=\"color:#64748b\">No incidents opened during this period.</p>"
    : `<table><thead><tr><th>Opened</th><th>Severity</th><th>Title</th><th>Status</th></tr></thead><tbody>${
        topIncidents.map(i => `<tr>
            <td>${htmlEscape(fmtDate(String(i.opened_at)))}</td>
            <td class="sev-${htmlEscape(i.severity)}">${htmlEscape(i.severity)}</td>
            <td>${htmlEscape(i.title)}</td>
            <td>${htmlEscape(i.status)}</td>
        </tr>`).join("")
      }</tbody></table>`
}

${(() => {
    const m = (summary.m365_shield ?? {}) as Record<string, unknown>;
    if (!m.enabled) return "";
    const mfaPct        = m.mfa_coverage_pct == null ? "n/a" : `${m.mfa_coverage_pct}%`;
    const breachUnack   = Number(m.breach_findings_unack ?? 0);
    const breachNew     = Number(m.breach_findings_new ?? 0);
    const adminsAtRisk  = Number(m.admins_at_risk ?? 0);
    const oauthHighRisk = Number(m.oauth_high_risk ?? 0);
    const anonShares    = Number(m.anonymous_share_links ?? 0);
    return `<h3>Microsoft 365 Shield</h3>
<div class="grid">
 <div class="card"><div class="label">MFA coverage</div><div class="value">${htmlEscape(mfaPct)}</div></div>
 <div class="card ${adminsAtRisk > 0 ? "alert" : "good"}"><div class="label">Admins without MFA</div><div class="value">${fmt(adminsAtRisk)}</div></div>
 <div class="card ${breachNew > 0 ? "alert" : "good"}"><div class="label">Breach findings this period</div><div class="value">${fmt(breachNew)}</div></div>
 <div class="card ${breachUnack > 0 ? "alert" : ""}"><div class="label">Breach findings unread</div><div class="value">${fmt(breachUnack)}</div></div>
 <div class="card ${oauthHighRisk > 0 ? "alert" : "good"}"><div class="label">High-risk OAuth apps</div><div class="value">${fmt(oauthHighRisk)}</div></div>
 <div class="card ${anonShares > 0 ? "alert" : "good"}"><div class="label">Anonymous share links</div><div class="value">${fmt(anonShares)}</div></div>
</div>`;
})()}

<h3>Top software in fleet</h3>
${topSoftware.length === 0
    ? "<p style=\"color:#64748b\">No software inventory yet.</p>"
    : `<table><thead><tr><th>Application</th><th>Installs</th></tr></thead><tbody>${
        topSoftware.slice(0, 10).map(s => `<tr><td>${htmlEscape(s.name)}</td><td>${htmlEscape(s.count)}</td></tr>`).join("")
      }</tbody></table>`
}

<div class="footer">
Generated by Mithras Threat Defence. To view live data, sign in at <a href="${SITE_URL}">${SITE_URL}</a>.
</div>
</body></html>`;
}

async function generateSiteExecSummary(
    orgName: string,
    site: Record<string, unknown>,
    summary: Record<string, unknown>,
    kind: string,
): Promise<string | null> {
    const key = await getOpenAiKey();
    if (!key) return null;
    const model = await getOpenAiModel();
    const supportsTemperature = !/^o1|^o4|^gpt-5/.test(model);
    const body: Record<string, unknown> = {
        model,
        max_tokens: 300,
        messages: [
            { role: "system", content: "You are a friendly MSP security analyst writing the opening paragraph of a customer's WordPress security report. Tone: confident, non-alarmist, scannable for a non-technical site owner. 3-5 short sentences. No markdown, no bullets, no headings. Lead with what we did to keep the site safe, then call out the most important thing they should know." },
            { role: "user", content: `Write the exec summary for this WordPress site report.

MSP: ${orgName}
Site: ${site.name ?? site.site_url}
URL: ${site.site_url}
WP version: ${site.wp_version ?? "unknown"} · PHP ${site.php_version ?? "unknown"} · ${site.plugin_count ?? 0} plugins · theme ${site.active_theme ?? "unknown"}
Report kind: ${kind}
Period: ${summary.period_start} → ${summary.period_end}

Open findings (severity): critical ${summary.findings_open_critical}, error ${summary.findings_open_error}, warning ${summary.findings_open_warning}. Resolved this period: ${summary.findings_resolved}.
Logins: ${summary.logins_success} successful, ${summary.logins_failed} failed.
Plugin/theme/user changes: ${summary.plugin_changes} plugin events, ${summary.user_changes} user changes, ${summary.role_changes} role changes.

Top open findings: ${JSON.stringify((summary.top_findings as Array<Record<string, unknown>> ?? []).slice(0, 5))}` },
        ],
    };
    if (supportsTemperature) body.temperature = 0.4;
    try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) return null;
        const raw = await resp.json();
        return raw?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch { return null; }
}

function sevClass(s: string) {
    switch (s) {
        case "critical": return "sev-Severe";
        case "error":    return "sev-High";
        case "warning":  return "sev-Moderate";
        default:         return "";
    }
}

function renderSiteReport(orgName: string, summary: Record<string, unknown>, kind: string, execSummary: string | null): string {
    const fmt = (n: unknown) => htmlEscape(n ?? 0);
    const site = (summary.site ?? {}) as Record<string, unknown>;
    const start = fmtDate(String(summary.period_start));
    const end   = fmtDate(String(summary.period_end));
    const findings = Array.isArray(summary.top_findings) ? summary.top_findings as Array<Record<string, unknown>> : [];
    const topIps   = Array.isArray(summary.top_failed_login_ips) ? summary.top_failed_login_ips as Array<Record<string, unknown>> : [];
    const topUsers = Array.isArray(summary.top_admin_logins) ? summary.top_admin_logins as Array<Record<string, unknown>> : [];

    const execSection = execSummary
        ? `<div class="exec"><div class="exec-label">AI executive summary</div><p>${htmlEscape(execSummary)}</p></div>`
        : "";

    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>${htmlEscape(site.name ?? site.site_url)} - WordPress security report</title>
<style>
 body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:#0f172a; max-width: 880px; margin: 32px auto; padding: 0 24px; line-height:1.5; }
 h1 { color:#00C4AB; letter-spacing:.04em; margin:0 0 4px 0; }
 h3 { margin-top: 28px; }
 .sub { color:#64748b; margin-bottom: 16px; }
 .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; margin: 20px 0; }
 .card { border:1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
 .card .label { color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
 .card .value { font-size:24px; font-weight:700; margin-top:4px; color:#0f172a; }
 .card.alert .value { color:#dc2626; }
 .card.good  .value { color:#059669; }
 table { width:100%; border-collapse: collapse; margin: 12px 0 28px 0; }
 th, td { text-align:left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size:13px; vertical-align: top; }
 th { background:#f8fafc; color:#475569; font-weight:600; }
 .sev-Severe   { color:#dc2626; font-weight:600; }
 .sev-High     { color:#ea580c; font-weight:600; }
 .sev-Moderate { color:#ca8a04; }
 .footer { color:#94a3b8; font-size:12px; margin-top:48px; border-top:1px solid #e2e8f0; padding-top:16px; }
 .exec { background:#f0fdfa; border:1px solid #00C4AB33; border-left:4px solid #00C4AB; border-radius:8px; padding:16px 20px; margin:24px 0; }
 .exec-label { color:#00897B; font-size:11px; text-transform:uppercase; letter-spacing:.10em; font-weight:700; margin-bottom:6px; }
 .exec p { margin:0; color:#0f172a; font-size:14px; line-height:1.6; }
 .meta { color:#475569; font-size:13px; margin-bottom:24px; }
 .meta code { background:#f1f5f9; padding:1px 6px; border-radius:4px; font-size:12px; }
</style></head>
<body>
<h1>MITHRAS</h1>
<div class="sub">${htmlEscape(orgName)} &middot; WordPress security report &middot; ${start} - ${end}</div>

<div class="meta">
<strong>${htmlEscape(site.name ?? site.site_url)}</strong> — ${htmlEscape(site.site_url)}<br/>
WordPress <code>${htmlEscape(site.wp_version ?? "?")}</code> · PHP <code>${htmlEscape(site.php_version ?? "?")}</code> · ${fmt(site.plugin_count)} plugins · theme <em>${htmlEscape(site.active_theme ?? "unknown")}</em>
</div>

${execSection}

<div class="grid">
 <div class="card ${Number(summary.findings_open_critical) > 0 ? "alert" : "good"}"><div class="label">Open critical</div><div class="value">${fmt(summary.findings_open_critical)}</div></div>
 <div class="card ${Number(summary.findings_open_error) > 0 ? "alert" : "good"}"><div class="label">Open errors</div><div class="value">${fmt(summary.findings_open_error)}</div></div>
 <div class="card ${Number(summary.findings_open_warning) > 0 ? "alert" : ""}"><div class="label">Open warnings</div><div class="value">${fmt(summary.findings_open_warning)}</div></div>
 <div class="card good"><div class="label">Resolved this period</div><div class="value">${fmt(summary.findings_resolved)}</div></div>

 <div class="card"><div class="label">Successful logins</div><div class="value">${fmt(summary.logins_success)}</div></div>
 <div class="card ${Number(summary.logins_failed) > 50 ? "alert" : ""}"><div class="label">Failed logins</div><div class="value">${fmt(summary.logins_failed)}</div></div>
 <div class="card"><div class="label">Plugin events</div><div class="value">${fmt(summary.plugin_changes)}</div></div>
 <div class="card ${Number(summary.role_changes) > 0 ? "alert" : ""}"><div class="label">Role changes</div><div class="value">${fmt(summary.role_changes)}</div></div>
</div>

<h3>Open findings</h3>
${findings.length === 0
    ? "<p style=\"color:#64748b\">No open security findings &mdash; site is in good shape.</p>"
    : `<table><thead><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Recommendation</th></tr></thead><tbody>${
        findings.map(f => `<tr>
            <td class="${sevClass(String(f.severity))}">${htmlEscape(f.severity)}</td>
            <td>${htmlEscape(f.category)}</td>
            <td>${htmlEscape(f.title)}</td>
            <td>${htmlEscape(f.recommendation ?? "")}</td>
        </tr>`).join("")
    }</tbody></table>`
}

<h3>Top failed-login source IPs</h3>
${topIps.length === 0
    ? "<p style=\"color:#64748b\">No failed login attempts logged this period.</p>"
    : `<table><thead><tr><th>IP address</th><th>Attempts</th></tr></thead><tbody>${
        topIps.map(r => `<tr><td><code>${htmlEscape(r.ip)}</code></td><td>${htmlEscape(r.count)}</td></tr>`).join("")
    }</tbody></table>`
}

<h3>Top admin logins</h3>
${topUsers.length === 0
    ? "<p style=\"color:#64748b\">No admin logins recorded this period.</p>"
    : `<table><thead><tr><th>User</th><th>Logins</th></tr></thead><tbody>${
        topUsers.map(r => `<tr><td><code>${htmlEscape(r.user)}</code></td><td>${htmlEscape(r.count)}</td></tr>`).join("")
    }</tbody></table>`
}

<div class="footer">
Generated by Mithras Threat Defence for ${htmlEscape(orgName)}.
</div>
</body></html>`;
}

// Calls the send-customer-report edge function if the org has any recipients
// subscribed to this report's kind. The send function fetches SMTP creds,
// downloads the PDF, and ships the multipart email. ad_hoc reports are never
// auto-sent — the UI's "Send now" button is the only path for those.
async function maybeSendReport(reportId: string, orgId: string, kind: string): Promise<void> {
    // Map report kind → the column on org_report_recipients that opts the user in.
    // Match this list to customer_reports.kind_check; ad_hoc has no auto-send target.
    const kindCol: Record<string, string> = { weekly: "weekly", monthly: "monthly", quarterly: "quarterly" };
    const col = kindCol[kind];
    if (!col) return;
    const { count } = await supabase
        .from("org_report_recipients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq(col, true);
    if (!count || count === 0) return;
    const resp = await fetch(`${PUBLIC_API_BASE}/send-customer-report`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ report_id: reportId }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        console.error(`send-customer-report returned ${resp.status}: ${txt}`);
    }
}

async function ensureBucket() {
    try {
        const { data: existing } = await supabase.storage.getBucket(REPORTS_BUCKET);
        if (existing) return;
    } catch { /* not found, fall through to create */ }
    await supabase.storage.createBucket(REPORTS_BUCKET, { public: false });
}

async function processQueuedRow(row: Record<string, unknown>): Promise<{ ok: boolean; err?: string }> {
    const id        = row.id as string;
    const orgId     = row.organization_id as string;
    const siteId    = (row.site_id ?? null) as string | null;
    const kind      = row.kind as string;
    const start     = row.period_start as string;
    const end       = row.period_end as string;

    try {
        await supabase.from("customer_reports").update({ status: "generating" }).eq("id", id);

        const { data: org, error: orgErr } = await supabase
            .from("organizations").select("name").eq("id", orgId).maybeSingle();
        if (orgErr || !org) throw new Error(`org lookup failed: ${orgErr?.message ?? "not found"}`);

        let html: string;
        let summary: Record<string, unknown>;
        let path: string;
        let pdfPath: string | null = null;
        let pdfBytes: Uint8Array | null = null;
        let pdfRenderError: string | null = null;

        if (siteId) {
            // Per-site WordPress security report. PDF rendering is not (yet) wired
            // for site reports — they ship as HTML only, just like before.
            const { data: siteSummary, error: sumErr } = await supabase
                .rpc("build_site_period_summary", { p_site: siteId, p_period_start: start, p_period_end: end });
            if (sumErr) throw new Error(`build_site_period_summary failed: ${sumErr.message}`);
            summary = siteSummary as Record<string, unknown>;
            const site = (summary.site ?? {}) as Record<string, unknown>;
            const execSummary = await generateSiteExecSummary(org.name as string, site, summary, kind);
            html = renderSiteReport(org.name as string, summary, kind, execSummary);
            path = `${orgId}/sites/${siteId}/${kind}-${new Date(start).toISOString().slice(0,10)}.html`;
        } else {
            // Org-wide report — HTML for in-browser viewing AND PDF for the
            // customer-facing monthly deliverable.
            const { data: orgSummary, error: sumErr } = await supabase
                .rpc("build_org_period_summary", { p_org: orgId, p_period_start: start, p_period_end: end });
            if (sumErr) throw new Error(`build_org_period_summary failed: ${sumErr.message}`);
            summary = orgSummary as Record<string, unknown>;
            const execSummary = await generateExecSummary(org.name as string, summary, kind);
            html = renderReport(org.name as string, summary, kind, execSummary);

            const stem = `${orgId}/${kind}-${new Date(start).toISOString().slice(0,10)}`;
            path = `${stem}.html`;
            pdfPath = `${stem}.pdf`;

            try {
                pdfBytes = await buildReportPdf(org.name as string, summary, kind, execSummary);
            } catch (pdfErr) {
                // PDF rendering must not break the HTML path — record + continue.
                pdfRenderError = "render:" + (pdfErr instanceof Error ? pdfErr.message : String(pdfErr));
                console.error("pdf render failed:", pdfRenderError);
                pdfBytes = null;
                pdfPath  = null;
            }
        }

        const { error: upErr } = await supabase.storage
            .from(REPORTS_BUCKET)
            .upload(path, new Blob([html], { type: "text/html" }), { upsert: true, contentType: "text/html" });
        if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

        if (pdfPath && pdfBytes) {
            const { error: pdfUpErr } = await supabase.storage
                .from(REPORTS_BUCKET)
                .upload(pdfPath, new Blob([pdfBytes], { type: "application/pdf" }),
                    { upsert: true, contentType: "application/pdf" });
            if (pdfUpErr) {
                pdfRenderError = "upload:" + pdfUpErr.message;
                console.error("pdf storage upload failed:", pdfRenderError);
                pdfPath = null;
            }
        }

        await supabase.from("customer_reports").update({
            status:            "ready",
            storage_path:      path,
            pdf_storage_path:  pdfPath,
            pdf_render_error:  pdfRenderError,
            summary:           summary,
            generated_at:      new Date().toISOString(),
        }).eq("id", id);

        // Best-effort auto-send to configured recipients. Don't fail the row
        // if send fails — the report is still on disk and the operator can
        // re-trigger Send from the UI.
        if (!siteId && pdfPath) {
            try {
                await maybeSendReport(id, orgId, kind);
            } catch (sendErr) {
                console.error("auto-send failed:", sendErr instanceof Error ? sendErr.message : sendErr);
            }
        }

        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("customer_reports").update({ status: "failed", error_message: msg }).eq("id", id);
        return { ok: false, err: msg };
    }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Auth: super-admin user OR pg_cron caller.
    //
    // pg_cron calls use a dedicated x-mithras-cron-secret header value that
    // lives only inside the database (platform_settings.mithras_cron_secret)
    // and in this function's MITHRAS_CRON_SECRET env var. Was previously a
    // service-key-as-bearer back-channel, which doubled the surface area of
    // the service role key. Transitional: legacy service-key-as-bearer is
    // still accepted while we cut over the cron job, then will be removed
    // in a follow-up wave.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const cronSecretHeader = req.headers.get("x-mithras-cron-secret") ?? "";
    const cronSecretEnv = Deno.env.get("MITHRAS_CRON_SECRET") ?? "";
    const isCronCall = !!cronSecretEnv && cronSecretHeader === cronSecretEnv;
    const isLegacyServiceCall = token === SUPABASE_SERVICE_KEY;
    const isServiceCall = isCronCall || isLegacyServiceCall;
    if (!isServiceCall) {
        if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);
        const { data: sa } = await supabase.from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
        if (!sa) return jsonResponse({ error: "forbidden_super_admin_only" }, 403, origin);
    }

    await ensureBucket();

    // Optional body: { batch_size, organization_id, kind, period_start, period_end }.
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const batch = Math.max(1, Math.min(50, Number(body.batch_size) || 10));

    // If the caller provides an explicit (org, kind, period) tuple — generate
    // one ad-hoc report and return immediately.
    if (body.organization_id && body.kind && body.period_start && body.period_end) {
        const siteIdFilter = body.site_id ? (body.site_id as string) : null;
        let probe = supabase.from("customer_reports").select("*")
            .eq("organization_id", body.organization_id as string)
            .eq("kind", body.kind as string)
            .eq("period_start", body.period_start as string);
        probe = siteIdFilter ? probe.eq("site_id", siteIdFilter) : probe.is("site_id", null);
        const { data: existing } = await probe.maybeSingle();

        // Short-circuit: if the report is already ready, return it without
        // regenerating (no need to burn LLM tokens for an unchanged period).
        if (existing && (existing as Record<string, unknown>).status === "ready") {
            return jsonResponse({
                processed: 0,
                ok: true,
                already_ready: true,
                storage_path: (existing as Record<string, unknown>).storage_path,
            }, 200, origin);
        }

        let row: Record<string, unknown> | null = (existing as Record<string, unknown> | null) ?? null;
        if (!row) {
            const { data: ins, error: insErr } = await supabase.from("customer_reports").insert({
                organization_id: body.organization_id,
                kind:            body.kind,
                period_start:    body.period_start,
                period_end:      body.period_end,
                site_id:         siteIdFilter,
                status:          "queued",
            }).select("*").single();
            if (insErr || !ins) {
                // Unique-index race — another caller inserted the same tuple. Re-fetch.
                let refetch = supabase.from("customer_reports").select("*")
                    .eq("organization_id", body.organization_id as string)
                    .eq("kind", body.kind as string)
                    .eq("period_start", body.period_start as string);
                refetch = siteIdFilter ? refetch.eq("site_id", siteIdFilter) : refetch.is("site_id", null);
                const { data: again } = await refetch.maybeSingle();
                if (!again) {
                    return jsonResponse({ error: "insert_failed", details: insErr?.message ?? "no row" }, 500, origin);
                }
                row = again as Record<string, unknown>;
            } else {
                row = ins as Record<string, unknown>;
            }
        }
        const result = await processQueuedRow(row);
        return jsonResponse({ processed: 1, ...result }, result.ok ? 200 : 500, origin);
    }

    // Pull queued rows and process them.
    const { data: queued, error: qErr } = await supabase.from("customer_reports")
        .select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(batch);
    if (qErr) return jsonResponse({ error: "queue_read_failed", details: qErr.message }, 500, origin);

    const results: Array<{ id: unknown; ok: boolean; err?: string }> = [];
    for (const row of (queued ?? [])) {
        const r = await processQueuedRow(row as Record<string, unknown>);
        results.push({ id: (row as Record<string, unknown>).id, ...r });
    }
    return jsonResponse({ processed: results.length, results }, 200, origin);
});
