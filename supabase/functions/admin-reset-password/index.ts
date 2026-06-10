// POST /functions/v1/admin-reset-password
//
// Admin-initiated password reset for another user.
//
// Request body (one of):
//   { mode: "email_link", target_user_id: uuid }
//      → mints a recovery link via GoTrue admin API. If SMTP is configured,
//        GoTrue will also email it. Returns the link to the caller so the
//        platform can copy/share it manually when SMTP is not wired.
//
//   { mode: "temp_password", target_user_id: uuid, password: string }
//      → sets the user's password directly via admin API. Returns ok=true.
//        Password must satisfy the same complexity policy as login.
//
// Caller must be a super-admin OR an org-admin of every organisation the
// target user belongs to. Plain org-members cannot reset other users.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

function passwordOk(pw: string): boolean {
    return pw.length >= 12
        && /[a-z]/.test(pw) && /[A-Z]/.test(pw)
        && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Per-IP rate limit — password reset is brute-forceable. 10/min is plenty
    // for an admin handling a queue; well below what a credential-stuffer needs.
    const rl = checkRateLimit(req, "admin-reset-password", { max: 10, windowMs: 60_000 });
    if (!rl.ok) return rateLimitResponse(rl, buildCorsHeaders(origin) as Record<string, string>);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const mode = String(body.mode ?? "");
    const targetUserId = String(body.target_user_id ?? "");
    if (!targetUserId) return jsonResponse({ error: "target_user_id_required" }, 400, origin);
    if (mode !== "email_link" && mode !== "temp_password") {
        return jsonResponse({ error: "invalid_mode" }, 400, origin);
    }

    // Authorise.
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();

    // Privilege-escalation guard: a non-super-admin must NEVER be able to
    // reset a super-admin's password (they could log in as the super-admin
    // and grant themselves cross-tenant access). Same for org owners —
    // require super-admin to reset an owner.
    if (!isSuper) {
        const { data: targetIsSuper } = await supabase
            .from("super_admins").select("user_id").eq("user_id", targetUserId).maybeSingle();
        if (targetIsSuper) {
            return jsonResponse({ error: "forbidden_target_is_super_admin" }, 403, origin);
        }

        // Caller must be admin/owner of EVERY org the target belongs to.
        const { data: targetMemberships } = await supabase
            .from("organization_memberships")
            .select("organization_id, role")
            .eq("user_id", targetUserId);
        if (!targetMemberships || targetMemberships.length === 0) {
            return jsonResponse({ error: "forbidden_target_has_no_org" }, 403, origin);
        }

        // Owners can only be reset by super-admins. This stops one owner from
        // resetting another owner's password and silently taking the org.
        const ownsAnything = targetMemberships.some(m => m.role === "owner");
        if (ownsAnything) {
            return jsonResponse({ error: "forbidden_target_is_owner" }, 403, origin);
        }

        for (const m of targetMemberships) {
            const { data: callerRole } = await supabase
                .from("organization_memberships")
                .select("role")
                .eq("user_id", user.id)
                .eq("organization_id", m.organization_id)
                .maybeSingle();
            if (!callerRole || (callerRole.role !== "admin" && callerRole.role !== "owner")) {
                return jsonResponse({ error: "forbidden_not_admin_of_targets_org" }, 403, origin);
            }
        }
    }

    // Look up the target's email.
    const { data: target, error: tErr } = await supabase.auth.admin.getUserById(targetUserId);
    if (tErr || !target?.user?.email) {
        return jsonResponse({ error: "target_not_found" }, 404, origin);
    }
    const targetEmail = target.user.email;

    // Audit trail.
    const audit = async (action: string, metadata: Record<string, unknown> = {}) => {
        try {
            // Pick any org the target belongs to so log lands somewhere visible.
            const { data: any_org } = await supabase
                .from("organization_memberships").select("organization_id")
                .eq("user_id", targetUserId).limit(1).maybeSingle();
            const orgId = any_org?.organization_id ?? null;
            if (orgId) {
                await supabase.rpc("log_activity", {
                    _org_id:        orgId,
                    _action:        action,
                    _resource_type: "user",
                    _resource_id:   targetUserId,
                    _metadata:      { target_email: targetEmail, ...metadata } as never,
                });
            }
        } catch { /* best effort */ }
    };

    if (mode === "email_link") {
        // generateLink does NOT send an email itself; GoTrue's email flow does
        // that separately if SMTP is configured. We always return the link so
        // operators can share it manually when SMTP isn't wired.
        const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink({
            type:  "recovery",
            email: targetEmail,
            options: { redirectTo: `${SITE_URL}/reset-password` },
        });
        if (linkErr || !linkRes?.properties?.action_link) {
            return jsonResponse({ error: "generate_link_failed", details: linkErr?.message }, 500, origin);
        }
        await audit("admin_password_reset_email_link", { mode });
        return jsonResponse({
            ok: true,
            mode,
            email: targetEmail,
            action_link: linkRes.properties.action_link,
            // GoTrue tries to email this too if SMTP is set; tell the caller so the
            // UI can phrase it appropriately ("we emailed them" vs "share this link").
            email_sent: !!linkRes.properties.email_otp,
        }, 200, origin);
    }

    // mode === "temp_password"
    const newPassword = String(body.password ?? "");
    if (!passwordOk(newPassword)) {
        return jsonResponse({
            error: "weak_password",
            requirements: "12+ chars including lowercase, uppercase, digit, and symbol",
        }, 400, origin);
    }

    const { error: updErr } = await supabase.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
    });
    if (updErr) {
        // Surface GoTrue's specific failure reason (e.g. weak_password)
        // — the original code returned only "update_failed" which made
        // misconfigured password policies impossible to debug from the UI.
        const goTrue = updErr as unknown as { message?: string; code?: number | string; status?: number };
        const isWeakPassword = goTrue.code === "weak_password" || /weak_password/i.test(goTrue.message ?? "");
        return jsonResponse({
            error: isWeakPassword ? "weak_password" : "update_failed",
            details: goTrue.message ?? "GoTrue did not return a reason. Check the supabase-auth container logs for the failed PUT /admin/users request.",
            gotrue_status: goTrue.status ?? null,
        }, isWeakPassword ? 400 : 500, origin);
    }
    await audit("admin_password_reset_temp", { mode });
    return jsonResponse({ ok: true, mode, email: targetEmail }, 200, origin);
});
