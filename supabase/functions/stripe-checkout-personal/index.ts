// POST /functions/v1/stripe-checkout-personal
//
// Creates a Stripe Checkout Session for a home-user subscription. Returns
// either { url: "https://checkout.stripe.com/..." } on success or a clear
// error including "stripe_not_configured" when env vars are missing — the
// frontend renders a friendly "subscriptions opening soon" message in
// that case so the page is usable from the moment it ships.
//
// Required env vars (set on docker02 in /opt/peritus-supabase/.env):
//   STRIPE_SECRET_KEY            sk_live_… or sk_test_…
//   STRIPE_HOMEUSER_PRICE_ID     price_… for the $6/month recurring price
//   STRIPE_HOMEUSER_SUCCESS_URL  e.g. https://www.mithras.com.au/personal/success
//   STRIPE_HOMEUSER_CANCEL_URL   e.g. https://www.mithras.com.au/personal

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { isValidEmail } from "../_shared/mime-safe.ts";
import { loadStripeConfig, isStripeReadyForCheckout } from "../_shared/stripe-config.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// Form-encode Stripe API body (Stripe accepts application/x-www-form-urlencoded).
function fenc(params: Record<string, string>): string {
    return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    const cfg = await loadStripeConfig(supabase);
    if (!isStripeReadyForCheckout(cfg)) {
        // Frontend renders a friendly "subscriptions opening soon" message
        // when it sees this specific error code.
        return json({ error: "stripe_not_configured" }, 400, origin);
    }

    let body: { email?: string } = {};
    try { body = await req.json(); } catch {}
    const email = (body.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) return json({ error: "invalid_email" }, 400, origin);

    // Soft duplicate-prevention: if this email already has an active
    // home_user org, hint the user via a specific error rather than
    // silently creating a parallel subscription.
    const { data: existing } = await supabase
        .from("organizations")
        .select("id, stripe_status")
        .eq("home_user_email", email)
        .eq("organization_type", "home_user")
        .maybeSingle();

    if (existing && existing.stripe_status === "active") {
        return json({ error: "already_subscribed", message: "This email already has an active subscription. Email support@mithras.com.au if you need help." }, 409, origin);
    }

    // Build the Stripe Checkout Session.
    // - mode=subscription so Stripe creates a recurring sub
    // - customer_email pre-fills the checkout
    // - allow_promotion_codes lets us run launch coupons
    // - metadata.role=home_user pins the org type the webhook should create
    const params: Record<string, string> = {
        mode: "subscription",
        "line_items[0][price]": cfg.homeuser_price_id,
        "line_items[0][quantity]": "1",
        customer_email: email,
        allow_promotion_codes: "true",
        success_url: `${cfg.success_url}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cfg.cancel_url,
        "metadata[role]": "home_user",
        "metadata[contact_email]": email,
        "subscription_data[metadata][role]": "home_user",
        "subscription_data[metadata][contact_email]": email,
    };

    try {
        const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cfg.secret_key}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: fenc(params),
        });
        const sj = await r.json();
        if (!r.ok) {
            return json({ error: "stripe_error", details: sj.error?.message ?? `HTTP ${r.status}` }, 502, origin);
        }
        return json({ url: sj.url, session_id: sj.id }, 200, origin);
    } catch (e: any) {
        return json({ error: "stripe_call_failed", details: e?.message }, 502, origin);
    }
});
