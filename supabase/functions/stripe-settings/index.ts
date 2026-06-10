// POST /functions/v1/stripe-settings
//
// Super-admin only. Read/write Stripe integration settings stored in
// platform_settings. Mirrors the smtp-settings pattern.
//
// Body actions:
//   { action: "get" }                          → current settings (secrets redacted)
//   { action: "save", settings: {...} }        → upsert; secret fields only overwritten if non-empty
//   { action: "status" }                       → quick ping against the stored secret_key
//   { action: "test_checkout" }                → mints a stripe checkout session to validate price + key
//
// Storage keys mirror the env vars used by stripe-checkout-personal,
// stripe-customer-portal, and stripe-webhook. See _shared/stripe-config.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { loadStripeConfig } from "../_shared/stripe-config.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

const ALL_KEYS = [
    "stripe_enabled",
    "stripe_secret_key",
    "stripe_webhook_secret",
    "stripe_homeuser_price_id",
    "stripe_homeuser_success_url",
    "stripe_homeuser_cancel_url",
    "stripe_homeuser_portal_return_url",
];

const SECRET_KEYS = new Set(["stripe_secret_key", "stripe_webhook_secret"]);

async function getAllSettings(): Promise<Record<string, unknown>> {
    const { data } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", ALL_KEYS);
    const out: Record<string, unknown> = {};
    for (const row of (data ?? [])) out[row.key as string] = row.value;
    // Redact secrets — frontend only needs to know whether one is stored.
    for (const k of SECRET_KEYS) {
        if (out[k] && String(out[k]).length > 0) out[k] = "__redacted__";
        else out[k] = "";
    }
    // Defaults for new installs.
    if (out.stripe_enabled === undefined || out.stripe_enabled === null) out.stripe_enabled = false;
    if (!out.stripe_homeuser_success_url)       out.stripe_homeuser_success_url       = "https://www.mithras.com.au/personal/success";
    if (!out.stripe_homeuser_cancel_url)        out.stripe_homeuser_cancel_url        = "https://www.mithras.com.au/personal";
    if (!out.stripe_homeuser_portal_return_url) out.stripe_homeuser_portal_return_url = "https://www.mithras.com.au/account";
    return out;
}

async function saveSettings(settings: Record<string, unknown>): Promise<void> {
    // platform_settings.value is TEXT — normalize booleans and nullables to strings.
    const upserts: Array<{ key: string; value: string; is_secret: boolean }> = [];
    for (const k of ALL_KEYS) {
        if (!(k in settings)) continue;
        const v = settings[k];
        // Secret fields: empty / __redacted__ means "leave as-is".
        if (SECRET_KEYS.has(k) && (v === "" || v === null || v === undefined || v === "__redacted__")) continue;
        const str = typeof v === "boolean" ? (v ? "true" : "false") : v === null || v === undefined ? "" : String(v);
        upserts.push({ key: k, value: str, is_secret: SECRET_KEYS.has(k) });
    }
    if (upserts.length === 0) return;
    const { error } = await supabase.from("platform_settings").upsert(upserts, { onConflict: "key" });
    if (error) throw new Error(error.message);
}

// Lightweight ping: list a single account.balance object. Confirms the
// secret key is valid and (when test/live mismatched) tells us which mode
// the key is in.
async function pingStripe(secretKey: string): Promise<{ ok: boolean; mode?: "test" | "live"; details?: string }> {
    if (!secretKey) return { ok: false, details: "no_secret_key" };
    try {
        const r = await fetch("https://api.stripe.com/v1/balance", {
            headers: { Authorization: `Bearer ${secretKey}` },
        });
        if (r.ok) {
            const mode = secretKey.startsWith("sk_live_") ? "live" : "test";
            return { ok: true, mode };
        }
        const body = await r.json().catch(() => ({}));
        return { ok: false, details: body?.error?.message ?? `HTTP ${r.status}` };
    } catch (e) {
        return { ok: false, details: e instanceof Error ? e.message : String(e) };
    }
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    // Auth: super-admin only.
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "missing_token" }, 401, origin);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "invalid_token" }, 401, origin);
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isSuper) return json({ error: "forbidden_super_admin_only" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action ?? "get");

    try {
        if (action === "get") {
            const settings = await getAllSettings();
            return json({ settings }, 200, origin);
        }
        if (action === "save") {
            const incoming = (body.settings ?? {}) as Record<string, unknown>;
            await saveSettings(incoming);
            return json({ ok: true }, 200, origin);
        }
        if (action === "status") {
            const cfg = await loadStripeConfig(supabase);
            const ping = await pingStripe(cfg.secret_key);
            return json({
                enabled: cfg.enabled,
                has_secret_key:        !!cfg.secret_key,
                has_webhook_secret:    !!cfg.webhook_secret,
                has_homeuser_price_id: !!cfg.homeuser_price_id,
                ping,
            }, 200, origin);
        }
        if (action === "test_checkout") {
            const cfg = await loadStripeConfig(supabase);
            if (!cfg.secret_key || !cfg.homeuser_price_id) {
                return json({ ok: false, error: "missing_secret_key_or_price_id" }, 400, origin);
            }
            const params = new URLSearchParams({
                mode: "subscription",
                "line_items[0][price]":    cfg.homeuser_price_id,
                "line_items[0][quantity]": "1",
                success_url:               cfg.success_url + "?session_id={CHECKOUT_SESSION_ID}",
                cancel_url:                cfg.cancel_url,
                customer_email:            user.email ?? "test@mithras.com.au",
            });
            const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
                method: "POST",
                headers: { Authorization: `Bearer ${cfg.secret_key}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
            });
            const sj = await r.json();
            if (!r.ok) return json({ ok: false, error: sj.error?.message ?? `HTTP ${r.status}` }, 502, origin);
            return json({ ok: true, url: sj.url, session_id: sj.id }, 200, origin);
        }
        return json({ error: "unknown_action" }, 400, origin);
    } catch (e) {
        return json({ error: "handler_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
    }
});
