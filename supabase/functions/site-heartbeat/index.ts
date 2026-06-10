// POST /functions/v1/site-heartbeat
// Headers: x-site-id, x-site-secret
// Body: { wp_version?, php_version?, plugin_count?, active_theme?, events?: [{event_type, severity?, actor_user_login?, actor_ip?, target?, summary, event_time, raw?}] }
//
// Stateless bearer-secret auth (sha256 of the per-site secret stored on the
// platform). Events stream into the partitioned site_event_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(body: unknown, status: number, origin: string | null) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string,string>) },
    });
}

const ALLOWED_SEVERITIES = new Set(["info","warning","error","critical"]);
const ALLOWED_EVENT_TYPES = new Set([
    "login_success", "login_failed", "user_created", "user_updated", "user_deleted", "role_changed",
    "plugin_activated", "plugin_deactivated", "plugin_installed", "plugin_updated", "plugin_deleted",
    "theme_switched", "theme_installed", "theme_updated", "theme_deleted",
    "post_created", "post_updated", "post_deleted", "post_status_changed",
    "comment_created", "comment_approved",
    "option_changed", "core_updated",
    "settings_changed", "permalink_changed", "file_changed", "site_health_alert",
    "lockout_triggered", "ip_blocked", "ip_unblocked",
    "protection_applied", "protection_failed",
    "audit_started", "audit_completed",
    "heartbeat",
]);
const ALLOWED_FINDING_CATEGORIES = new Set([
    "core","plugin","theme","file_integrity","user","config","login","server","headers","content",
]);

interface IncomingEvent {
    event_type: string;
    severity?: string;
    actor_user_login?: string;
    actor_ip?: string;
    target?: string;
    summary: string;
    event_time: string;
    raw?: unknown;
}

interface IncomingFinding {
    finding_key:    string;
    category:       string;
    severity?:      string;
    title:          string;
    description?:   string;
    recommendation?: string;
    evidence?:      unknown;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const siteId = req.headers.get("x-site-id") ?? "";
    const secret = req.headers.get("x-site-secret") ?? "";
    if (!siteId || !secret) return jsonResponse({ error: "missing_auth_headers" }, 401, origin);

    const { data: site, error: siteErr } = await supabase
        .from("monitored_sites")
        .select("id, organization_id, site_secret_hash, is_active")
        .eq("id", siteId)
        .maybeSingle();
    if (siteErr || !site) return jsonResponse({ error: "site_not_found" }, 401, origin);
    if (!site.is_active)  return jsonResponse({ error: "site_inactive" }, 403, origin);
    // Null hash = site was created via SQL without going through site-enroll.
    // Reject before the constant-time loop to avoid TypeError 500 + info leak.
    if (!site.site_secret_hash) return jsonResponse({ error: "invalid_site_secret" }, 401, origin);

    const expected = await sha256Hex(secret);
    // Constant-time compare.
    let ok = expected.length === (site.site_secret_hash as string).length;
    if (ok) {
        let acc = 0;
        for (let i = 0; i < expected.length; i++) acc |= expected.charCodeAt(i) ^ (site.site_secret_hash as string).charCodeAt(i);
        ok = acc === 0;
    }
    if (!ok) return jsonResponse({ error: "invalid_site_secret" }, 401, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const remoteIp =
        (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") || null;

    // Update site posture snapshot.
    await supabase.from("monitored_sites").update({
        wp_version:    (body.wp_version    as string) ?? null,
        php_version:   (body.php_version   as string) ?? null,
        plugin_count:  Number(body.plugin_count ?? 0),
        active_theme:  (body.active_theme  as string) ?? null,
        last_seen_at:  new Date().toISOString(),
        last_ip:       remoteIp,
    }).eq("id", siteId);

    let stored = 0;
    if (Array.isArray(body.events) && body.events.length > 0) {
        const cleaned = (body.events as IncomingEvent[])
            .filter(e => e && e.event_type && e.summary && e.event_time)
            .filter(e => ALLOWED_EVENT_TYPES.has(e.event_type))
            .slice(0, 500)
            .map(e => ({
                site_id:          siteId,
                organization_id:  site.organization_id,
                event_type:       e.event_type,
                severity:         ALLOWED_SEVERITIES.has(e.severity ?? "info") ? (e.severity ?? "info") : "info",
                actor_user_login: e.actor_user_login ? String(e.actor_user_login).slice(0, 200) : null,
                actor_ip:         e.actor_ip ?? null,
                target:           e.target ? String(e.target).slice(0, 500) : null,
                summary:          String(e.summary).slice(0, 2000),
                event_time:       e.event_time,
                raw:              e.raw ?? null,
            }));
        if (cleaned.length > 0) {
            const { error: insErr, count } = await supabase
                .from("site_event_logs")
                .insert(cleaned, { count: "exact" });
            if (insErr) console.error("site_event_logs insert", insErr);
            stored = count ?? cleaned.length;
        }
    }

    // Audit findings. Upsert by (site_id, finding_key) so re-emitting the same
    // finding rolls last_seen + severity rather than creating duplicates.
    // When the plugin re-runs an audit and DOESN'T re-emit a finding, the
    // platform-side auto-resolve cron (TBD) closes anything not seen in 7
    // days; for v1 we don't ship that cron — the UI can show "stale" findings.
    let findingsStored = 0;
    let findingsResolved = 0;
    if (Array.isArray(body.findings) && body.findings.length > 0) {
        const cleaned = (body.findings as IncomingFinding[])
            .filter(f => f && f.finding_key && f.title && ALLOWED_FINDING_CATEGORIES.has(f.category))
            .slice(0, 500)
            .map(f => ({
                site_id:         siteId,
                organization_id: site.organization_id,
                finding_key:     String(f.finding_key).slice(0, 300),
                category:        f.category,
                severity:        ALLOWED_SEVERITIES.has(f.severity ?? "info") ? (f.severity ?? "info") : "info",
                title:           String(f.title).slice(0, 500),
                description:     f.description ? String(f.description).slice(0, 4000) : null,
                recommendation:  f.recommendation ? String(f.recommendation).slice(0, 4000) : null,
                evidence:        f.evidence ?? null,
                status:          "open",
                last_seen_at:    new Date().toISOString(),
            }));
        if (cleaned.length > 0) {
            // Upsert: on conflict bump last_seen_at + severity + evidence, leave first_seen_at.
            const { error: insErr } = await supabase.from("site_audit_findings")
                .upsert(cleaned, { onConflict: "site_id,finding_key" });
            if (insErr) console.error("site_audit_findings upsert", insErr);
            findingsStored = cleaned.length;
        }
    }

    // If the plugin completed a full audit run and tells us which keys were
    // current as of that run, auto-resolve any open finding not in the list.
    // Uses an RPC with a real text[] parameter — the previous PostgREST
    // .not("finding_key","in", quoted_list) was fragile against keys
    // containing parens/commas, and the RPC also guards empty arrays
    // (which would otherwise mass-resolve every open finding).
    if (Array.isArray(body.audit_keys_current) && body.audit_completed === true) {
        const keys = (body.audit_keys_current as unknown[]).map(String).filter(k => k.length > 0);
        if (keys.length > 0) {
            const { data: resolvedCount } = await supabase
                .rpc("resolve_stale_site_findings", { p_site: siteId, p_active_keys: keys });
            findingsResolved = Number(resolvedCount ?? 0);
        }
    }

    // Return protection settings + settings_version so the plugin can apply them.
    const { data: prot } = await supabase
        .from("site_protection_settings")
        .select("settings, settings_version")
        .eq("site_id", siteId)
        .maybeSingle();

    return jsonResponse({
        ok:                true,
        events_stored:     stored,
        findings_stored:   findingsStored,
        findings_resolved: findingsResolved,
        protection: prot
            ? { version: prot.settings_version, settings: prot.settings }
            : null,
        server_time: new Date().toISOString(),
    }, 200, origin);
});
