// GET /functions/v1/radar-public
//
// Anonymous-readable snapshot of every radar tile plus a compact summary of
// the latest external feeds. No auth required — the radar page is a public
// marketing / transparency surface. Tiles where tenant_count < per-tile
// minimum are suppressed; the public consumer never sees the underlying
// counts that would betray fleet size or a single-customer signal.
//
// Caching: Cache-Control: public, max-age=300 — five minutes is fine because
// the source data is refreshed hourly by radar-refresh.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Mirrors radar-refresh — anything below the floor is suppressed at read time.
const MIN_TENANTS: Record<string, number> = {
    threats_blocked_week:        3,
    top_malware_families:        3,
    top_cves:                    3,
    eol_exposure:                3,
    brute_force_ports:           3,
    attack_origins:              3,
    phishing_themes:             3,
    wp_bruteforce_trend:         0,
    // AI digest derives from already-public external feeds — no tenant
    // attribution, no fleet floor required.
    ai_weekly_digest:            0,
};

function jsonResponse(body: unknown, status: number, origin: string | null, cacheSeconds: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type":  "application/json",
            "cache-control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` : "no-store",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);
    if (req.method !== "GET")     return jsonResponse({ error: "method_not_allowed" }, 405, origin, 0);

    const { data: tiles, error: tilesErr } = await supabase
        .from("radar_snapshots")
        .select("tile_key, data, tenant_count, computed_at");

    if (tilesErr) {
        return jsonResponse({ error: "snapshot_fetch_failed" }, 500, origin, 0);
    }

    const out: Record<string, unknown> = {};
    let oldest: string | null = null;
    for (const row of (tiles ?? []) as Array<{ tile_key: string; data: unknown; tenant_count: number; computed_at: string }>) {
        const floor = MIN_TENANTS[row.tile_key] ?? 3;
        const suppressed = row.tenant_count < floor;
        out[row.tile_key] = suppressed
            ? { suppressed: true, message: "Not enough contributing tenants yet — this tile activates once more customers are protected." }
            : row.data;
        if (!oldest || row.computed_at < oldest) oldest = row.computed_at;
    }

    // External feeds — only export a compact summary, not the full body, to
    // keep the public response small and avoid republishing third-party data.
    const { data: feeds } = await supabase
        .from("radar_external_feeds")
        .select("feed_key, source, fetched_at, data");

    const kev   = (feeds ?? []).find((f) => f.feed_key === "cisa_kev");
    const tfx   = (feeds ?? []).find((f) => f.feed_key === "threatfox_24h");
    const urlh  = (feeds ?? []).find((f) => f.feed_key === "urlhaus_recent");
    const feodo = (feeds ?? []).find((f) => f.feed_key === "feodo_botnet_c2");
    const acsc  = (feeds ?? []).find((f) => f.feed_key === "acsc_alerts");
    const rw    = (feeds ?? []).find((f) => f.feed_key === "ransomware_live_week");

    const externalSummary = {
        cisa_kev: kev ? {
            source:      kev.source,
            fetched_at:  kev.fetched_at,
            total_known_exploited: Object.keys((kev.data ?? {}) as Record<string, unknown>).length,
        } : null,
        threatfox_24h: tfx ? {
            source:      tfx.source,
            fetched_at:  tfx.fetched_at,
            sample:      ((tfx.data as { items?: unknown[] })?.items ?? []).slice(0, 10),
        } : null,
        urlhaus: urlh ? {
            source:      urlh.source,
            fetched_at:  urlh.fetched_at,
            sample:      ((urlh.data as { items?: unknown[] })?.items ?? []).slice(0, 8),
        } : null,
        feodo: feodo ? {
            source:      feodo.source,
            fetched_at:  feodo.fetched_at,
            sample:      ((feodo.data as { items?: unknown[] })?.items ?? []).slice(0, 10),
        } : null,
        acsc_alerts: acsc ? {
            source:      acsc.source,
            fetched_at:  acsc.fetched_at,
            sample:      ((acsc.data as { items?: unknown[] })?.items ?? []).slice(0, 8),
        } : null,
        ransomware_live: rw ? {
            source:      rw.source,
            fetched_at:  rw.fetched_at,
            total_last7: ((rw.data as { total_last7?: number })?.total_last7 ?? 0),
            sample:      ((rw.data as { items?: unknown[] })?.items ?? []).slice(0, 10),
        } : null,
    };

    return jsonResponse({
        tiles: out,
        external: externalSummary,
        meta: {
            generated_at:    new Date().toISOString(),
            snapshot_oldest: oldest,
        },
    }, 200, origin, 300);
});
