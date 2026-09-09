// POST /functions/v1/admin-resend-home-welcome
//
// Super-admin endpoint that re-issues the 3-step home-user welcome email
// for a given org. Useful when a customer's original magic link expired
// (24h TTL), or when Microsoft 365 Safe Links pre-fetched and consumed
// the link before the customer could click it.
//
// Body: { org_id: uuid }
// Auth: user JWT, caller must be a super-admin (verified via RPC).
//
// Pipeline:
//   1. Verify caller is a super-admin
//   2. Look up the home-user org (must be organization_type='home_user')
//   3. Find the most recent valid enrollment_token for that org
//   4. Generate a fresh magiclink via the GoTrue admin API
//   5. Dispatch send-home-user-welcome with the new link + existing code
//
// Returns: { ok: true, dispatched_to: email } on success.
// Audit:   logs to activity_logs as "resend_home_welcome".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResp(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405, origin);

    // Caller must present a real user JWT — service-role bearer is blocked
    // so a leaked key can't fire welcome emails to arbitrary customers.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt || jwt === SUPABASE_SERVICE_KEY) {
        return jsonResp({ error: "user_token_required" }, 401, origin);
    }
    const { data: userResp } = await supabase.auth.getUser(jwt);
    const userId = userResp?.user?.id;
    if (!userId) return jsonResp({ error: "invalid_token" }, 401, origin);

    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (!isSuper) return jsonResp({ error: "forbidden_not_super_admin" }, 403, origin);

    let body: { org_id?: string } = {};
    try { body = await req.json(); } catch {}
    const orgId = String(body.org_id ?? "").trim();
    if (!orgId) return jsonResp({ error: "org_id_required" }, 400, origin);

    // Org must exist and be a home_user org. Anything else and we refuse —
    // the welcome email's content is shaped for home subscribers.
    const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .select("id, organization_type, home_user_email, name")
        .eq("id", orgId)
        .maybeSingle();
    if (orgErr || !org) return jsonResp({ error: "org_not_found" }, 404, origin);
    if (org.organization_type !== "home_user") {
        return jsonResp({ error: "not_a_home_user_org" }, 400, origin);
    }
    const email = String(org.home_user_email ?? "").trim().toLowerCase();
    if (!email) return jsonResp({ error: "org_has_no_home_user_email" }, 400, origin);

    // Most recent unexpired enrolment token wins. If there isn't one we
    // bail rather than silently sending an email without a usable code.
    const { data: tok } = await supabase
        .from("enrollment_tokens")
        .select("token, expires_at, use_count, max_uses")
        .eq("organization_id", orgId)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!tok?.token) {
        return jsonResp({ error: "no_valid_enrollment_token" }, 409, origin);
    }
    // Don't re-send if the token is exhausted — the customer already
    // enrolled and a new welcome would be confusing.
    if (typeof tok.use_count === "number" && typeof tok.max_uses === "number" && tok.use_count >= tok.max_uses) {
        return jsonResp({ error: "enrollment_token_exhausted" }, 409, origin);
    }

    // Generate a fresh magic link via the GoTrue admin API. Hard-pinned
    // redirect prevents an open-redirect/token-theft vector if this
    // function is ever reachable from a less-trusted caller.
    let actionLink: string | null = null;
    try {
        const linkResp = await supabase.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo: `${SITE_URL}/account` },
        });
        actionLink = (linkResp as any)?.data?.properties?.action_link ?? null;
    } catch (e) {
        console.error("generateLink failed", e);
    }
    if (!actionLink) return jsonResp({ error: "magic_link_generation_failed" }, 500, origin);

    // Hand off to the existing welcome-email function. Service-role bearer
    // here is the SHARED internal pattern (function-to-function inside the
    // same project) so we don't have to teach send-home-user-welcome about
    // caller identity. send-home-user-welcome doesn't accept untrusted
    // callers anyway — it expects service-role.
    const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-home-user-welcome`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
            org_id:            orgId,
            email,
            enrolment_code:    tok.token,
            account_setup_url: actionLink,
        }),
    });
    if (!sendResp.ok) {
        const text = await sendResp.text();
        console.error("send-home-user-welcome failed:", sendResp.status, text);
        return jsonResp({ error: "welcome_dispatch_failed", details: text.slice(0, 500) }, 502, origin);
    }

    // Audit trail — every welcome resend lands on activity_logs with the
    // operator's user_id so we can answer "who re-sent X's welcome?" later.
    // We raw-insert (service-role client) and stamp user_id explicitly
    // rather than calling log_activity(): the RPC reads auth.uid() inside
    // SECURITY DEFINER, which is NULL when invoked via service-role bearer,
    // losing the operator's identity.
    try {
        const { error: auditErr } = await supabase.from("activity_logs").insert({
            organization_id: orgId,
            user_id:         userId,
            action:          "resend_home_welcome",
            resource_type:   "organization",
            resource_id:     orgId,
            details:         { email, dispatched_at: new Date().toISOString() },
        } as any);
        if (auditErr) console.error("activity_logs insert failed (non-fatal)", auditErr.message);
    } catch (e) {
        console.error("activity_logs insert threw (non-fatal)", e);
    }

    return jsonResp({ ok: true, dispatched_to: email }, 200, origin);
});
