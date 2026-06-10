// POST /functions/v1/stripe-customer-portal
//
// Mints a Stripe Billing Portal session URL for the calling user's home-user
// subscription. Returns { url } on success or a clear error code. The frontend
// opens the returned URL in a top-level navigation — Stripe hosts the cancel /
// update-card flow and redirects back to the configured return URL when done.
//
// Authorisation: the caller must be a verified Supabase user AND an admin of
// a home-user org. We never accept a stripe_customer_id in the request body —
// we look it up server-side from the user's organization membership.
//
// Required env vars (set on docker02 in /opt/peritus-supabase/.env):
//   STRIPE_SECRET_KEY                sk_live_… or sk_test_…
//   STRIPE_HOMEUSER_PORTAL_RETURN_URL  (optional) defaults to mithras.com.au/account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { loadStripeConfig, isStripeReadyForPortal } from "../_shared/stripe-config.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

function fenc(params: Record<string, string>): string {
    return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    const cfg = await loadStripeConfig(adminClient);
    if (!isStripeReadyForPortal(cfg)) {
        return json({ error: "stripe_not_configured" }, 400, origin);
    }

    // Verify the caller's JWT via the anon client so we get auth.uid().
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "auth_required" }, 401, origin);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "auth_invalid" }, 401, origin);
    const userId = userData.user.id;

    // Find a home-user org the caller is an admin/owner of, with a Stripe
    // customer id on file. SECURITY DEFINER not required — RLS on
    // organization_memberships + organizations already scopes to the caller.
    // We use the service-role client so we can read stripe_customer_id even
    // if RLS would mask it from a member view; the prior auth check guarantees
    // the user is legitimate.
    const { data: rows, error: rowsErr } = await adminClient
        .from("organization_memberships")
        .select("role, organizations!inner(id, organization_type, stripe_customer_id, stripe_subscription_id, stripe_status)")
        .eq("user_id", userId);

    if (rowsErr) return json({ error: "lookup_failed", details: rowsErr.message }, 500, origin);

    const homeRow = (rows ?? []).find((r: any) =>
        r.organizations?.organization_type === "home_user" &&
        ["owner", "admin"].includes(r.role) &&
        r.organizations?.stripe_customer_id);

    if (!homeRow) return json({ error: "no_home_user_subscription" }, 404, origin);
    const customerId = (homeRow as any).organizations.stripe_customer_id as string;

    // Create the billing portal session.
    try {
        const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cfg.secret_key}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: fenc({ customer: customerId, return_url: cfg.portal_return_url }),
        });
        const sj = await r.json();
        if (!r.ok) {
            return json({ error: "stripe_error", details: sj.error?.message ?? `HTTP ${r.status}` }, 502, origin);
        }
        return json({ url: sj.url }, 200, origin);
    } catch (e: any) {
        return json({ error: "stripe_call_failed", details: e?.message }, 502, origin);
    }
});
