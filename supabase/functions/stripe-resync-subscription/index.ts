// POST /functions/v1/stripe-resync-subscription
//
// Force-refreshes an organisation's stripe_status + stripe_current_period_end
// directly from the Stripe API, bypassing the webhook channel. Use cases:
//
//   1. The customer.subscription.updated webhook event never landed
//      (endpoint added after the subscription was created, or Stripe
//      dropped delivery for any reason), so the org row drifted out of
//      sync with Stripe's source of truth.
//   2. Operator wants to verify an org's current Stripe state matches
//      what we have in the DB after a status investigation.
//   3. Backfill after restoring from a backup that pre-dates the latest
//      subscription change.
//
// Auth: super-admin only. The function reads the JWT, confirms the caller
// is a super-admin, then performs the resync. service_role can also call
// (for future cron-based drift detection).
//
// Body: { org_id: string }
//
// Response:
//   200 { ok: true, status, current_period_end, changed: bool, prev: {...} }
//   400 invalid input / org missing stripe_subscription_id
//   401 not authenticated / not super-admin
//   404 org not found
//   502 stripe API error
//
// This is a self-contained tool: no shared modules beyond _shared/cors
// and the existing stripe-config loader so we can deploy it without
// touching any other function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { loadStripeConfig } from "../_shared/stripe-config.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function callerIsSuperAdmin(jwt: string): Promise<boolean> {
    // Build a request-scoped client so RPCs see the caller's auth.uid().
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabaseAdmin
        .from("super_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error) return false;
    return !!data;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    // Auth gate: super-admin OR service_role bearer.
    const authHeader = req.headers.get("authorization") ?? "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    let allowed = false;
    if (bearer === SUPABASE_SERVICE_KEY) {
        allowed = true;
    } else if (bearer) {
        allowed = await callerIsSuperAdmin(bearer);
    }
    if (!allowed) return json({ error: "unauthorized" }, 401, origin);

    let body: { org_id?: string } = {};
    try { body = await req.json(); } catch {}
    const orgId = String(body.org_id ?? "").trim();
    if (!orgId) return json({ error: "missing_org_id" }, 400, origin);

    const cfg = await loadStripeConfig(supabaseAdmin);
    if (!cfg.secret_key) return json({ error: "stripe_not_configured" }, 400, origin);

    const { data: org, error: orgErr } = await supabaseAdmin
        .from("organizations")
        .select("id, name, stripe_subscription_id, stripe_customer_id, stripe_status, stripe_current_period_end, is_active")
        .eq("id", orgId)
        .maybeSingle();
    if (orgErr || !org) return json({ error: "org_not_found", detail: orgErr?.message }, 404, origin);
    if (!org.stripe_subscription_id) return json({ error: "no_subscription_on_org" }, 400, origin);

    const subId = org.stripe_subscription_id;
    const stripeResp = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
        headers: { "Authorization": `Bearer ${cfg.secret_key}` },
    });
    const sub = await stripeResp.json();
    if (!stripeResp.ok) {
        return json({ error: "stripe_api_error", status: stripeResp.status, detail: sub.error?.message ?? null }, 502, origin);
    }

    const newStatus    = String(sub.status ?? "");
    // Stripe moved current_period_end from the subscription root to
    // items.data[0].current_period_end in their flexible billing model.
    // Prefer the item-level value, fall back to the legacy root for older
    // subscriptions that still expose it there.
    const itemPeriodEnd = sub.items?.data?.[0]?.current_period_end ?? null;
    const rootPeriodEnd = sub.current_period_end ?? null;
    const periodEndSec  = itemPeriodEnd ?? rootPeriodEnd;
    const newPeriodEnd  = periodEndSec ? new Date(periodEndSec * 1000).toISOString() : null;
    const newIsActive   = newStatus === "active" || newStatus === "trialing";

    const prev = {
        stripe_status: org.stripe_status,
        stripe_current_period_end: org.stripe_current_period_end,
        is_active: org.is_active,
    };

    const { error: updErr } = await supabaseAdmin
        .from("organizations")
        .update({
            stripe_status:             newStatus,
            stripe_current_period_end: newPeriodEnd,
            is_active:                 newIsActive,
        } as any)
        .eq("id", orgId);
    if (updErr) return json({ error: "db_update_failed", detail: updErr.message }, 500, origin);

    const changed =
        prev.stripe_status !== newStatus ||
        prev.stripe_current_period_end !== newPeriodEnd ||
        prev.is_active !== newIsActive;

    return json({
        ok: true,
        org_id: orgId,
        subscription_id: subId,
        status: newStatus,
        current_period_end: newPeriodEnd,
        is_active: newIsActive,
        changed,
        prev,
    }, 200, origin);
});
