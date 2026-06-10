// POST /functions/v1/m365-settings
//
// Super-admin only. Manages the platform-level Azure AD multi-tenant app
// credentials used by the M365 / Entra ID ITDR integration. These are
// platform settings (one set per Mithras instance), distinct from the
// per-customer m365_tenants rows that hold each customer's OAuth tokens.
//
// Body actions:
//   { action: "get" }     → returns current settings (client_secret redacted)
//   { action: "save", settings: { client_id, client_secret, redirect_uri, authority } }
//                         → upserts settings; client_secret only overwritten
//                           if non-empty (empty == keep what's stored)
//
// Stored under these keys in platform_settings:
//   m365_azure_client_id
//   m365_azure_client_secret  (is_secret=true)
//   m365_azure_redirect_uri
//   m365_azure_authority

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const KEYS = [
    "m365_azure_client_id",
    "m365_azure_client_secret",
    "m365_azure_redirect_uri",
    "m365_azure_authority",
];

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getAllSettings(): Promise<Record<string, string>> {
    const { data } = await supabase
        .from("platform_settings").select("key, value").in("key", KEYS);
    const out: Record<string, string> = {};
    for (const row of (data ?? [])) {
        out[row.key as string] = (row.value ?? "") as string;
    }
    if (!out.m365_azure_authority) out.m365_azure_authority = "https://login.microsoftonline.com";
    return out;
}

async function saveSettings(settings: Record<string, string>) {
    const upserts: Array<{ key: string; value: string; is_secret?: boolean }> = [];
    for (const k of KEYS) {
        if (!(k in settings)) continue;
        const v = settings[k];
        // Empty secret means leave as-is.
        if (k === "m365_azure_client_secret" && (v === "" || v == null)) continue;
        upserts.push({
            key: k,
            value: String(v ?? ""),
            is_secret: k === "m365_azure_client_secret",
        });
    }
    if (upserts.length === 0) return;
    const { error } = await supabase
        .from("platform_settings").upsert(upserts, { onConflict: "key" });
    if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const rl = checkRateLimit(req, "m365-settings", { max: 30, windowMs: 60_000 });
    if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isSuper) return jsonResponse({ error: "forbidden_super_admin_only" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action ?? "");

    if (action === "get") {
        const s = await getAllSettings();
        if (s.m365_azure_client_secret) s.m365_azure_client_secret = "__redacted__";
        return jsonResponse({ ok: true, settings: s }, 200, origin);
    }

    if (action === "save") {
        const settings = (body.settings as Record<string, string>) ?? {};
        if (settings.m365_azure_client_secret === "__redacted__") {
            delete settings.m365_azure_client_secret;
        }
        try {
            await saveSettings(settings);
            return jsonResponse({ ok: true }, 200, origin);
        } catch (e) {
            return jsonResponse({ error: "save_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
        }
    }

    return jsonResponse({ error: "invalid_action" }, 400, origin);
});
