// GET /functions/v1/public-config
//
// Returns the small subset of platform_settings that is safe to read
// without auth — currently the three analytics keys consumed by the
// marketing surfaces. Every other row in platform_settings (OpenAI key,
// service role key, cron secret, etc.) is gated behind super-admin RLS;
// this function never reads them.
//
// Why an edge function and not a public view: the platform_settings
// table holds real secrets. Cleaner to expose an explicit allowlist
// here than try to row-policy-RLS just three keys on a sensitive
// table — one missing policy bug would leak a service key.
//
// Cache-Control: 60s so a fresh visitor's browser caches the response
// and we don't re-query the DB on every internal navigation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Explicit allowlist. If a row isn't in here, it's NEVER returned, even
// if some future migration accidentally drops is_secret on a sensitive key.
const PUBLIC_KEYS = [
    "analytics_gtm_id",
    "analytics_track_logged_in",
    "analytics_consent_mode",
];

Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;
    const origin = req.headers.get("origin");
    const cors = buildCorsHeaders(origin) as Record<string, string>;

    if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
            status: 405,
            headers: { "content-type": "application/json", ...cors },
        });
    }

    const { data, error } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", PUBLIC_KEYS);

    if (error) {
        return new Response(JSON.stringify({ error: "settings_load_failed" }), {
            status: 500,
            headers: { "content-type": "application/json", ...cors },
        });
    }

    const map: Record<string, string> = {};
    for (const row of data ?? []) {
        map[row.key] = row.value ?? "";
    }

    const body = {
        analytics: {
            gtm_id:           map["analytics_gtm_id"] ?? "",
            track_logged_in:  map["analytics_track_logged_in"] === "true",
            consent_mode:     map["analytics_consent_mode"] === "true",
        },
    };

    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            "content-type":  "application/json",
            "cache-control": "public, max-age=60, stale-while-revalidate=300",
            ...cors,
        },
    });
});
