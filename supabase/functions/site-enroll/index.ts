// POST /functions/v1/site-enroll
// Body: { enrollment_token: string, site_url: string, name?: string, wp_version?: string, php_version?: string }
// Response 200: { site_id: string, site_secret: string, api_base_url: string }
//
// One-way: site_secret is returned exactly once. The WP plugin stores it
// locally and includes it in every subsequent x-site-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE      = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function base64UrlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}
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

function normaliseUrl(u: string): string | null {
    try {
        const url = new URL(u);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        // Strip trailing slash, lowercase host.
        url.hash = "";
        url.search = "";
        url.host = url.host.toLowerCase();
        return url.toString().replace(/\/$/, "");
    } catch { return null; }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const token   = String(body.enrollment_token ?? "").trim();
    const siteUrl = normaliseUrl(String(body.site_url ?? ""));
    if (!token || !siteUrl) {
        return jsonResponse({ error: "missing_or_invalid_fields", required: ["enrollment_token", "site_url"] }, 400, origin);
    }

    const { data: reserved, error: reserveErr } = await supabase
        .rpc("reserve_site_enrollment_slot", { p_token: token });
    if (reserveErr) {
        console.error("reserve_site_enrollment_slot failed", reserveErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!reserved || reserved.length === 0) {
        const { data: probe } = await supabase
            .from("site_enrollment_tokens").select("expires_at, use_count, max_uses").eq("token", token).maybeSingle();
        if (!probe) return jsonResponse({ error: "token_invalid" }, 401, origin);
        if (new Date(probe.expires_at).getTime() < Date.now()) return jsonResponse({ error: "token_expired" }, 410, origin);
        return jsonResponse({ error: "token_exhausted", max_uses: probe.max_uses, use_count: probe.use_count }, 410, origin);
    }
    const orgId = reserved[0].organization_id as string;

    const secret = generateSecret();
    const hash   = await sha256Hex(secret);
    const name   = (body.name as string)?.trim() || new URL(siteUrl).host;

    // Upsert so re-enrolling the same site URL rolls its secret rather than
    // creating duplicate rows.
    const { data: site, error: upsertErr } = await supabase
        .from("monitored_sites")
        .upsert({
            organization_id:  orgId,
            site_url:         siteUrl,
            name,
            site_secret_hash: hash,
            enrolled_via:     token,
            wp_version:       (body.wp_version  as string) ?? null,
            php_version:      (body.php_version as string) ?? null,
            is_active:        true,
            last_seen_at:     new Date().toISOString(),
        }, { onConflict: "organization_id,site_url" })
        .select("id").single();
    if (upsertErr || !site) {
        console.error("monitored_sites upsert failed", upsertErr);
        return jsonResponse({ error: "enroll_failed" }, 500, origin);
    }

    await supabase.from("site_enrollment_tokens")
        .update({ used_by_site_id: site.id }).eq("token", token);

    return jsonResponse({
        site_id:      site.id,
        site_secret:  secret,
        api_base_url: PUBLIC_API_BASE,
    }, 200, origin);
});
