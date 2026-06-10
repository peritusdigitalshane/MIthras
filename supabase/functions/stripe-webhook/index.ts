// POST /functions/v1/stripe-webhook
//
// Receives Stripe events. Three we care about for the home-user channel:
//
//   checkout.session.completed       — provision the org + enrolment token,
//                                       send the agent-install welcome email
//   customer.subscription.updated    — sync stripe_status + period_end
//   customer.subscription.deleted    — mark org as canceled
//
// Required env vars:
//   STRIPE_SECRET_KEY           — used to verify the signature
//   STRIPE_WEBHOOK_SECRET       — the whsec_… for THIS webhook endpoint
//
// Stripe sends raw bytes signed with HMAC-SHA256(timestamp.body, secret).
// We verify here rather than trusting the request — anyone can call this URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadStripeConfig } from "../_shared/stripe-config.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResp(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

// Stripe webhook signature: t=<unix>, v1=<sha256_hex>
async function verifyStripeSignature(rawBody: string, sigHeader: string, secret: string): Promise<boolean> {
    if (!secret) return false;
    const parts: Record<string, string> = {};
    for (const p of sigHeader.split(",")) {
        const [k, v] = p.split("=", 2);
        if (k && v) parts[k.trim()] = v.trim();
    }
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;
    // Reject events older than 5 minutes to prevent replay.
    const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parseInt(t, 10));
    if (ageSec > 300) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
    const macHex = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    // Constant-time compare
    if (macHex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < macHex.length; i++) diff |= macHex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
}

function slugFromEmail(email: string): string {
    const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    const rand = Math.random().toString(36).slice(2, 8);
    return `home-${base}-${rand}`;
}

function generateEnrolmentCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += chars.charAt(b % chars.length);
    return out;
}

// On a fresh checkout we (a) create the org row, (b) issue an enrolment
// token so the agent install command can authenticate, (c) trigger the
// welcome email out-of-band so this handler returns 200 quickly.
async function handleCheckoutCompleted(session: any): Promise<void> {
    const email = String(session.customer_email ?? session.metadata?.contact_email ?? "").toLowerCase();
    if (!email) throw new Error("checkout_session_missing_email");

    const stripeCustomerId     = String(session.customer ?? "");
    const stripeSubscriptionId = String(session.subscription ?? "");
    if (!stripeSubscriptionId) throw new Error("checkout_session_missing_subscription");

    // Idempotency: if we've already processed this subscription, skip.
    const { data: existingByStripe } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", stripeSubscriptionId)
        .maybeSingle();
    if (existingByStripe) return;

    const orgName = `Home: ${email}`;
    const slug    = slugFromEmail(email);

    const { data: orgRow, error: orgErr } = await supabase
        .from("organizations")
        .insert({
            name: orgName,
            slug,
            organization_type: "home_user",
            home_user_email: email,
            stripe_customer_id:      stripeCustomerId,
            stripe_subscription_id:  stripeSubscriptionId,
            stripe_status:           "active",
            wholesale_price_cents:   600,   // home-user retail = $6
            currency_code:           "AUD",
            is_active:               true,
        } as any)
        .select()
        .single();
    if (orgErr) throw new Error(`org_insert_failed: ${orgErr.message}`);

    // Single-use enrolment token the agent installer will use.
    const code = generateEnrolmentCode();
    await supabase.from("enrollment_tokens").insert({
        token: code,
        organization_id: orgRow.id,
        is_active: true,
        max_uses: 1,
    } as any);

    // Fire off the welcome email — non-fatal if it fails (we'll retry from
    // the admin console).
    try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-home-user-welcome`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` },
            body: JSON.stringify({ org_id: orgRow.id, email, enrolment_code: code }),
        });
    } catch (e) {
        console.error("welcome email dispatch failed", e);
    }
}

async function handleSubscriptionChange(sub: any, statusOverride?: string): Promise<void> {
    const subId  = String(sub.id);
    const status = statusOverride ?? String(sub.status);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

    await supabase.from("organizations").update({
        stripe_status: status,
        stripe_current_period_end: periodEnd,
        // If subscription is canceled/unpaid, soft-suspend the org so the
        // agent stops ingesting (it'll bounce on heartbeat). Re-activate
        // when status returns to active.
        is_active: status === "active" || status === "trialing",
    } as any).eq("stripe_subscription_id", subId);
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405);

    const sigHeader = req.headers.get("stripe-signature");
    if (!sigHeader) return jsonResp({ error: "missing_signature" }, 400);

    const rawBody = await req.text();
    const cfg = await loadStripeConfig(supabase);
    if (!cfg.webhook_secret) return jsonResp({ error: "webhook_secret_not_configured" }, 400);
    const valid = await verifyStripeSignature(rawBody, sigHeader, cfg.webhook_secret);
    if (!valid) return jsonResp({ error: "invalid_signature" }, 401);

    let event: any;
    try { event = JSON.parse(rawBody); } catch { return jsonResp({ error: "bad_json" }, 400); }

    try {
        switch (event.type) {
            case "checkout.session.completed":
                if (event.data?.object?.metadata?.role === "home_user") {
                    await handleCheckoutCompleted(event.data.object);
                }
                break;
            case "customer.subscription.updated":
                await handleSubscriptionChange(event.data.object);
                break;
            case "customer.subscription.deleted":
                await handleSubscriptionChange(event.data.object, "canceled");
                break;
            // Other event types: ignored.
        }
        return jsonResp({ received: true, type: event.type }, 200);
    } catch (e: any) {
        // Return 500 so Stripe retries — DON'T return 200 on failure.
        console.error(`webhook handler failed for ${event.type}:`, e);
        return jsonResp({ error: "handler_failed", details: e?.message }, 500);
    }
});
