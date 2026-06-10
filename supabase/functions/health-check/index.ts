// GET /functions/v1/health-check
//
// Single aggregated health snapshot for the super-admin Health Dashboard.
// Probes every signal server-side with short timeouts so a single hung
// dependency can't block the whole response.
//
// Auth: caller's JWT must belong to a super admin. The dashboard polls
// this every 30s; failed auth returns 401 fast.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MESH_BASE_URL        = Deno.env.get("MESH_BASE_URL") ?? "https://remote.mithras.com.au";
const PUBLIC_API_BASE      = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

async function probeHttp(url: string, expectStatus?: number[]): Promise<{ ok: boolean; status: number | null; latency_ms: number | null; error?: string }> {
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5_000);
        const r = await fetch(url, { method: "GET", signal: ctrl.signal });
        clearTimeout(t);
        const ok = expectStatus ? expectStatus.includes(r.status) : r.status < 500;
        return { ok, status: r.status, latency_ms: Date.now() - start };
    } catch (e) {
        return { ok: false, status: null, latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
}

// All registered edge functions. Probed in parallel on every health poll.
// Anything 5xx or unreachable = down (likely a runtime crash or missing
// container). Anything 2xx/3xx/4xx = up (the runtime served it; auth
// rejection or method-not-allowed still proves liveness).
const EDGE_FUNCTIONS = [
    "admin-reset-password",
    "agent-api", "agent-app-control", "agent-enroll", "agent-heartbeat",
    "agent-installer", "agent-legacy-upgrade", "agent-script", "agent-version-check",
    "ai-investigate-alert", "ai-security-advisor", "ai-triage-alert", "ai-triage-incident",
    "check-openai-models",
    "cleanup-old-data",
    "cve-auto-protect", "cve-auto-scan", "cve-mitigation-advisor",
    "generate-customer-report", "send-customer-report",
    "health-check",
    "m365-oauth-callback", "m365-oauth-start", "m365-poll-tenants", "m365-settings",
    "mesh-session-start",
    "notify-alert",
    "router-checkin",
    "site-enroll", "site-heartbeat",
    "smtp-settings",
    "soc-bridge",
    "virustotal-lookup", "vulnerability-scan",
];

async function probeAllEdgeFunctions(baseUrl: string) {
    const results = await Promise.all(EDGE_FUNCTIONS.map(async (name) => {
        const r = await probeHttp(`${baseUrl}/functions/v1/${name}`);
        return {
            name,
            // 5xx / network error / abort = down. 2xx/3xx/4xx = up. The
            // function ran; auth or method rejection is fine - the runtime
            // proved it can serve the route.
            healthy: r.status !== null && r.status < 500,
            status:  r.status,
            latency_ms: r.latency_ms,
            error: r.error,
        };
    }));
    const down = results.filter(r => !r.healthy);
    return {
        total:      results.length,
        healthy:    results.length - down.length,
        unhealthy:  down.length,
        unhealthy_names: down.map(r => r.name),
        per_function:   results.sort((a, b) =>
            (Number(a.healthy) - Number(b.healthy)) || (a.name < b.name ? -1 : 1)
        ),
    };
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isSuper) return jsonResponse({ error: "forbidden_super_admin_only" }, 403, origin);

    const startedAt = Date.now();
    const now = new Date();

    // ─── Run every probe in parallel, each with its own timeout. ───────────
    const [
        dbHealthRes,
        fleetRes,
        commandsRes,
        bundleRes,
        meshRes,
        m365Res,
        cronRes,
        socRes,
        functionsRes,
    ] = await Promise.all([
        withTimeout(probeDatabase(), 3_000, { status: "down" as const, error: "timeout" }),
        withTimeout(probeFleet(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeCommands(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeAgentBundle(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeHttp(`${MESH_BASE_URL}/`), 5_000, { ok: false, status: null, latency_ms: null, error: "timeout" }),
        withTimeout(probeM365(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeCron(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeAiSoc(), 3_000, { status: "unknown" as const, error: "timeout" }),
        withTimeout(probeAllEdgeFunctions(PUBLIC_API_BASE), 8_000, { total: 0, healthy: 0, unhealthy: 0, unhealthy_names: ["timeout"] as string[], per_function: [] as Array<{ name: string; healthy: boolean; status: number | null; latency_ms: number | null; error?: string }> }),
    ]);

    // ── Compute traffic-light buckets ─────────────────────────────────────
    // RED if any of these fail:
    //   - DB query failed
    //   - agent-heartbeat function is down (the headline 12h-outage signal)
    //   - zero endpoints heartbeated in the last hour AND fleet has any
    const heartbeatFn = functionsRes.per_function.find(f => f.name === "agent-heartbeat");
    const fleetHasEndpoints = ("total_active" in fleetRes && (fleetRes.total_active ?? 0) > 0);
    const fleetAliveCritical = !fleetHasEndpoints || ("active_1h" in fleetRes && (fleetRes.active_1h ?? 0) > 0);

    const isDown =
        dbHealthRes.status !== "ok" ||
        (heartbeatFn ? !heartbeatFn.healthy : true) ||
        !fleetAliveCritical;

    // AMBER if any non-critical signal degraded:
    //   - any OTHER edge function is down
    //   - MeshCentral unreachable
    //   - M365 tenants with stale polls
    //   - stuck dispatched commands
    //   - no endpoints heartbeated in the last 5 min (fleet alive but slow)
    //   - agent bundle older than 30 days
    const nonHeartbeatDownCount = functionsRes.unhealthy_names.filter(n => n !== "agent-heartbeat").length;
    const fleetActiveRecently = !fleetHasEndpoints || ("active_5min" in fleetRes && (fleetRes.active_5min ?? 0) > 0);
    const bundleStale = "age_days" in bundleRes && (bundleRes.age_days ?? 0) > 30;
    const stuckCmds = "stuck_over_15min" in commandsRes && (commandsRes.stuck_over_15min ?? 0) > 0;
    const m365Stale = "tenants_stale_poll_1h" in m365Res && (m365Res.tenants_stale_poll_1h ?? 0) > 0;

    const isDegraded =
        nonHeartbeatDownCount > 0 ||
        !meshRes.ok ||
        !fleetActiveRecently ||
        bundleStale ||
        stuckCmds ||
        m365Stale;

    const overall: "healthy" | "degraded" | "down" =
        isDown ? "down" : isDegraded ? "degraded" : "healthy";

    return jsonResponse({
        generated_at: now.toISOString(),
        generation_ms: Date.now() - startedAt,
        overall,
        // Surface the exact reasons that drove the colour so the dashboard
        // can render a "why" tooltip without re-deriving it.
        signals: {
            db_ok:                  dbHealthRes.status === "ok",
            heartbeat_fn_ok:        !!heartbeatFn?.healthy,
            fleet_alive_1h:         fleetAliveCritical,
            fleet_alive_5min:       fleetActiveRecently,
            other_functions_down:   nonHeartbeatDownCount,
            meshcentral_ok:         meshRes.ok,
            stuck_commands:         stuckCmds,
            bundle_age_over_30d:    bundleStale,
            m365_stale_polls:       m365Stale,
        },
        database: dbHealthRes,
        edge_functions: {
            base_url: PUBLIC_API_BASE,
            ...functionsRes,
        },
        fleet: fleetRes,
        commands: commandsRes,
        agent_bundle: bundleRes,
        meshcentral: {
            base_url: MESH_BASE_URL,
            ...meshRes,
        },
        m365: m365Res,
        pg_cron: cronRes,
        ai_soc: socRes,
    }, 200, origin);
});

async function probeDatabase() {
    const start = Date.now();
    const { data, error } = await supabase.rpc("get_db_version_for_health").maybeSingle();
    if (error && error.code !== "PGRST116" && error.code !== "42883") {
        // Fall back to a plain SELECT to avoid blocking on a missing RPC
        const { error: e2 } = await supabase.from("endpoints").select("id", { head: true, count: "exact" }).limit(1);
        return { status: e2 ? "down" : "ok" as const, latency_ms: Date.now() - start, error: e2?.message ?? null };
    }
    return { status: "ok" as const, latency_ms: Date.now() - start, version: (data as { version?: string } | null)?.version ?? null };
}

async function probeFleet() {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const oneDayAgo  = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

    const [total, active5, active1h, stale1h, offline1d, softDeleted] = await Promise.all([
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).is("deleted_at", null),
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).is("deleted_at", null).gt("last_seen_at", fiveMinAgo),
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).is("deleted_at", null).gt("last_seen_at", oneHourAgo),
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).is("deleted_at", null).lt("last_seen_at", oneHourAgo).gt("last_seen_at", oneDayAgo),
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).is("deleted_at", null).lt("last_seen_at", oneDayAgo),
        supabase.from("endpoints").select("id", { head: true, count: "exact" }).not("deleted_at", "is", null),
    ]);

    const { data: versionRows } = await supabase
        .from("endpoints").select("agent_version").is("deleted_at", null).not("agent_version", "is", null);
    const versionCounts: Record<string, number> = {};
    for (const r of (versionRows ?? [])) {
        const v = (r as { agent_version: string | null }).agent_version ?? "(unknown)";
        versionCounts[v] = (versionCounts[v] ?? 0) + 1;
    }
    const agent_versions = Object.entries(versionCounts)
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) => b.count - a.count);

    return {
        status: "ok" as const,
        total_active:           total.count ?? 0,
        active_5min:            active5.count ?? 0,
        active_1h:              active1h.count ?? 0,
        stale_1h_to_1d:         stale1h.count ?? 0,
        offline_over_1d:        offline1d.count ?? 0,
        soft_deleted:           softDeleted.count ?? 0,
        agent_versions,
    };
}

async function probeCommands() {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const twentyFourHrAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

    const [queued, dispatched, stuck, ok24, fail24] = await Promise.all([
        supabase.from("agent_commands").select("id", { head: true, count: "exact" }).eq("status", "queued"),
        supabase.from("agent_commands").select("id", { head: true, count: "exact" }).eq("status", "dispatched"),
        supabase.from("agent_commands").select("id", { head: true, count: "exact" }).eq("status", "dispatched").lt("dispatched_at", fifteenMinAgo),
        supabase.from("agent_commands").select("id", { head: true, count: "exact" }).eq("status", "succeeded").gt("completed_at", twentyFourHrAgo),
        supabase.from("agent_commands").select("id", { head: true, count: "exact" }).eq("status", "failed").gt("completed_at", twentyFourHrAgo),
    ]);

    return {
        status: "ok" as const,
        queued:                  queued.count ?? 0,
        dispatched:              dispatched.count ?? 0,
        stuck_over_15min:        stuck.count ?? 0,
        succeeded_24h:           ok24.count ?? 0,
        failed_24h:              fail24.count ?? 0,
    };
}

async function probeAgentBundle() {
    const { data } = await supabase
        .from("agent_versions")
        .select("version, sha256, download_url, published_at")
        .eq("runtime", "powershell")
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) return { status: "missing" as const };
    const ageMs = Date.now() - new Date((data as { published_at: string }).published_at).getTime();
    return {
        status: "ok" as const,
        version:        (data as { version: string }).version,
        sha256:         (data as { sha256: string }).sha256,
        download_url:   (data as { download_url: string }).download_url,
        published_at:   (data as { published_at: string }).published_at,
        age_days:       Math.floor(ageMs / (24 * 60 * 60_000)),
    };
}

async function probeM365() {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const [tenants, stale, errored] = await Promise.all([
        supabase.from("m365_tenants").select("id", { head: true, count: "exact" }).eq("consent_state", "active"),
        supabase.from("m365_tenants").select("id", { head: true, count: "exact" }).eq("consent_state", "active").lt("last_poll_at", oneHourAgo),
        supabase.from("m365_tenants").select("id", { head: true, count: "exact" }).eq("consent_state", "active").not("last_poll_error", "is", null),
    ]);
    return {
        status: "ok" as const,
        tenants_connected:       tenants.count ?? 0,
        tenants_stale_poll_1h:   stale.count ?? 0,
        tenants_with_poll_error: errored.count ?? 0,
    };
}

async function probeCron() {
    // pg_cron's tables live in the cron schema. PostgREST exposes public
    // only by default, so use an RPC if defined; otherwise skip gracefully.
    const { data, error } = await supabase.rpc("get_pg_cron_health").maybeSingle();
    if (error && error.code !== "PGRST116" && error.code !== "42883") {
        return { status: "unknown" as const, error: error.message };
    }
    return {
        status: "ok" as const,
        ...(data ?? {}),
    };
}

async function probeAiSoc() {
    const twentyFourHrAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [triages, investigations, openAlerts, criticalAlerts] = await Promise.all([
        supabase.from("ai_triage_decisions").select("id", { head: true, count: "exact" }).gt("created_at", twentyFourHrAgo),
        supabase.from("ai_investigations").select("id", { head: true, count: "exact" }).gt("created_at", twentyFourHrAgo),
        supabase.from("alerts").select("id", { head: true, count: "exact" }).eq("acknowledged", false),
        supabase.from("alerts").select("id", { head: true, count: "exact" }).eq("acknowledged", false).eq("severity", "critical"),
    ]);
    return {
        status: "ok" as const,
        triages_24h:        triages.count ?? 0,
        investigations_24h: investigations.count ?? 0,
        open_alerts:        openAlerts.count ?? 0,
        critical_alerts:    criticalAlerts.count ?? 0,
    };
}
