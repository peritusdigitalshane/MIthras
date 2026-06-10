// Shared Stripe configuration loader.
//
// Stripe credentials can live in two places:
//   1. Env vars on docker02 (legacy, set in /opt/peritus-supabase/.env)
//   2. The platform_settings table (managed by the super-admin Settings UI)
//
// Env vars take precedence so an operator can override DB-stored values
// from the host without touching the database. If neither is set we
// return a sentinel that the calling function uses to short-circuit to
// "stripe_not_configured".
//
// Keys in platform_settings:
//   stripe_enabled                       (boolean, "true"/"false")
//   stripe_secret_key                    sk_live_… / sk_test_…
//   stripe_webhook_secret                whsec_…
//   stripe_homeuser_price_id             price_…
//   stripe_homeuser_success_url
//   stripe_homeuser_cancel_url
//   stripe_homeuser_portal_return_url
//
// platform_settings.value is jsonb. supabase-js auto-parses it. For
// strings we usually upsert a bare string (which becomes a JSON-quoted
// string), so we always pass the raw value through String() at read.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface StripeConfig {
    enabled:           boolean;
    secret_key:        string;
    webhook_secret:    string;
    homeuser_price_id: string;
    success_url:       string;
    cancel_url:        string;
    portal_return_url: string;
}

const KEYS = [
    "stripe_enabled",
    "stripe_secret_key",
    "stripe_webhook_secret",
    "stripe_homeuser_price_id",
    "stripe_homeuser_success_url",
    "stripe_homeuser_cancel_url",
    "stripe_homeuser_portal_return_url",
] as const;

const ENV_FALLBACKS: Record<typeof KEYS[number], string> = {
    stripe_enabled:                    "STRIPE_ENABLED",
    stripe_secret_key:                 "STRIPE_SECRET_KEY",
    stripe_webhook_secret:             "STRIPE_WEBHOOK_SECRET",
    stripe_homeuser_price_id:          "STRIPE_HOMEUSER_PRICE_ID",
    stripe_homeuser_success_url:       "STRIPE_HOMEUSER_SUCCESS_URL",
    stripe_homeuser_cancel_url:        "STRIPE_HOMEUSER_CANCEL_URL",
    stripe_homeuser_portal_return_url: "STRIPE_HOMEUSER_PORTAL_RETURN_URL",
};

const DEFAULTS = {
    success_url:       "https://www.mithras.com.au/personal/success",
    cancel_url:        "https://www.mithras.com.au/personal",
    portal_return_url: "https://www.mithras.com.au/account",
};

function asString(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return String(v);
}

function asBool(v: unknown): boolean {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v === "true";
    return false;
}

export async function loadStripeConfig(supabase: SupabaseClient): Promise<StripeConfig> {
    const fromDb: Record<string, unknown> = {};
    try {
        const { data } = await supabase
            .from("platform_settings")
            .select("key, value")
            .in("key", KEYS as unknown as string[]);
        for (const row of (data ?? [])) fromDb[row.key as string] = row.value;
    } catch {
        // If the table isn't there yet, fall through to env-only.
    }

    const pick = (k: typeof KEYS[number]): string => {
        const env = Deno.env.get(ENV_FALLBACKS[k]);
        if (env && env.length > 0) return env;
        return asString(fromDb[k]);
    };

    return {
        enabled:           asBool(Deno.env.get(ENV_FALLBACKS.stripe_enabled)) || asBool(fromDb.stripe_enabled) || !!pick("stripe_secret_key"),
        secret_key:        pick("stripe_secret_key"),
        webhook_secret:    pick("stripe_webhook_secret"),
        homeuser_price_id: pick("stripe_homeuser_price_id"),
        success_url:       pick("stripe_homeuser_success_url")       || DEFAULTS.success_url,
        cancel_url:        pick("stripe_homeuser_cancel_url")        || DEFAULTS.cancel_url,
        portal_return_url: pick("stripe_homeuser_portal_return_url") || DEFAULTS.portal_return_url,
    };
}

// Convenience predicate for "do we have enough to actually call Stripe?"
export function isStripeReadyForCheckout(cfg: StripeConfig): boolean {
    return !!cfg.secret_key && !!cfg.homeuser_price_id;
}

export function isStripeReadyForPortal(cfg: StripeConfig): boolean {
    return !!cfg.secret_key;
}
