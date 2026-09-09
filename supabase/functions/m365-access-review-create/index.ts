// POST /functions/v1/m365-access-review-create
//
// Operator-triggered. Body: { organization_id, review_kind, due_days?: number }
// Pulls the relevant directory subjects from Graph (admins / guests),
// creates an m365_access_reviews row and one m365_access_review_items row
// per subject. Operator then decides keep/remove on each.
//
// Phase 2: review_kind 'admin' + 'guest'. 'mailbox_delegate' deferred.
//
// Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getPlatformSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const v = data?.value;
    if (typeof v === "string") return v;
    return null;
}

interface TenantRow {
    id: string;
    organization_id: string;
    tenant_id: string;
    access_token: string | null;
    refresh_token: string | null;
    access_token_expires_at: string | null;
    scopes: string[] | null;
}

async function ensureFreshToken(t: TenantRow): Promise<string> {
    const now = Date.now();
    const exp = t.access_token_expires_at ? new Date(t.access_token_expires_at).getTime() : 0;
    if (t.access_token && exp > now + 30_000) return t.access_token;

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret) throw new Error("m365_credentials_missing");
    if (!t.refresh_token) throw new Error("no_refresh_token");

    const scopes = (t.scopes && t.scopes.length > 0)
        ? t.scopes
        : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];

    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id,
        clientId, clientSecret,
        refreshToken: t.refresh_token,
        scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = {
        access_token: tok.access_token,
        access_token_expires_at: newExpiresAt,
    };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) {
        patch.refresh_token = tok.refresh_token;
    }
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.id);
    return tok.access_token;
}

async function authoriseUser(req: Request): Promise<{ userId: string } | null> {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    if (jwt === SUPABASE_SERVICE_KEY) return null;
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { userId: user.id };
}

async function userIsOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", {
        _user_id: userId, _org_id: orgId,
    });
    return isAdmin === true;
}

interface AdminMember {
    role_template_id: string;
    role_display_name: string;
    user_id: string;
    user_upn: string;
}

async function listAdmins(token: string): Promise<AdminMember[]> {
    const roles: Array<{ id: string; displayName: string; roleTemplateId: string }> = [];
    let next: string | null = "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,roleTemplateId";
    while (next) {
        const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) break;
        const body = await r.json() as { value?: typeof roles; "@odata.nextLink"?: string };
        if (body.value) roles.push(...body.value);
        next = body["@odata.nextLink"] ?? null;
    }

    const members: AdminMember[] = [];
    for (const role of roles) {
        let mNext: string | null = `https://graph.microsoft.com/v1.0/directoryRoles/${role.id}/members?$select=id,userPrincipalName`;
        while (mNext) {
            const r = await fetch(mNext, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
            if (!r.ok) break;
            const body = await r.json() as { value?: Array<{ id: string; userPrincipalName?: string }>; "@odata.nextLink"?: string };
            for (const m of body.value ?? []) {
                if (m.userPrincipalName) {
                    members.push({
                        role_template_id:  role.roleTemplateId,
                        role_display_name: role.displayName,
                        user_id:           m.id,
                        user_upn:          m.userPrincipalName,
                    });
                }
            }
            mNext = body["@odata.nextLink"] ?? null;
        }
    }
    return members;
}

interface GuestUser {
    user_id: string;
    user_upn: string;
    display_name: string;
    created_datetime: string | null;
    last_signin_at: string | null;
}

async function listGuests(token: string): Promise<GuestUser[]> {
    const all: GuestUser[] = [];
    let next: string | null =
        "https://graph.microsoft.com/v1.0/users?$filter=userType eq 'Guest'&$select=id,userPrincipalName,displayName,createdDateTime,signInActivity&$top=200";
    while (next) {
        const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) break;
        const body = await r.json() as {
            value?: Array<{ id: string; userPrincipalName: string; displayName: string; createdDateTime?: string; signInActivity?: { lastSignInDateTime?: string } }>;
            "@odata.nextLink"?: string;
        };
        for (const u of body.value ?? []) {
            all.push({
                user_id:          u.id,
                user_upn:         u.userPrincipalName,
                display_name:     u.displayName,
                created_datetime: u.createdDateTime ?? null,
                last_signin_at:   u.signInActivity?.lastSignInDateTime ?? null,
            });
        }
        next = body["@odata.nextLink"] ?? null;
    }
    return all;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: { organization_id?: string; review_kind?: string; due_days?: number };
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
    if (!body.organization_id) return json({ error: "organization_id_required" }, 400, origin);
    if (!body.review_kind || !["admin", "guest"].includes(body.review_kind)) {
        return json({ error: "review_kind_invalid", detail: "admin | guest" }, 400, origin);
    }

    const allowed = await userIsOrgAdmin(caller.userId, body.organization_id);
    if (!allowed) return json({ error: "forbidden" }, 403, origin);

    const { data: org } = await supabase
        .from("organizations")
        .select("id, m365_shield_enabled")
        .eq("id", body.organization_id)
        .maybeSingle();
    if (!org) return json({ error: "organization_not_found" }, 404, origin);
    if (!org.m365_shield_enabled) return json({ error: "m365_shield_not_enabled" }, 409, origin);

    const { data: tenants } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes")
        .eq("organization_id", body.organization_id)
        .eq("consent_state", "active");
    const t = (tenants ?? [])[0] as TenantRow | undefined;
    if (!t) return json({ error: "no_active_tenant" }, 409, origin);

    let accessToken: string;
    try { accessToken = await ensureFreshToken(t); }
    catch (e) { return json({ error: "token_refresh_failed", detail: String((e as Error).message ?? e).slice(0, 200) }, 502, origin); }

    const dueDays = Math.max(1, Math.min(90, body.due_days ?? 14));
    const due_at = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: review, error: revErr } = await supabase
        .from("m365_access_reviews")
        .insert({
            organization_id: body.organization_id,
            m365_tenant_id:  t.id,
            review_kind:     body.review_kind,
            created_by:      caller.userId,
            due_at,
        })
        .select("id")
        .single();
    if (revErr || !review) return json({ error: "review_insert_failed", detail: revErr?.message }, 500, origin);

    const items: Array<{ review_id: string; subject_id: string; subject_label: string; detail: Record<string, unknown> }> = [];

    if (body.review_kind === "admin") {
        const admins = await listAdmins(accessToken);
        // De-duplicate per user, collect their roles into detail.roles.
        const byUser = new Map<string, { upn: string; roles: Array<{ id: string; name: string }> }>();
        for (const a of admins) {
            const entry = byUser.get(a.user_id) ?? { upn: a.user_upn, roles: [] };
            entry.roles.push({ id: a.role_template_id, name: a.role_display_name });
            byUser.set(a.user_id, entry);
        }
        for (const [userId, info] of byUser) {
            items.push({
                review_id:     review.id,
                subject_id:    userId,
                subject_label: info.upn,
                detail:        { roles: info.roles },
            });
        }
    } else if (body.review_kind === "guest") {
        const guests = await listGuests(accessToken);
        for (const g of guests) {
            items.push({
                review_id:     review.id,
                subject_id:    g.user_id,
                subject_label: g.user_upn,
                detail: {
                    display_name:     g.display_name,
                    created_datetime: g.created_datetime,
                    last_signin_at:   g.last_signin_at,
                    dormant_days:     g.last_signin_at
                        ? Math.floor((Date.now() - new Date(g.last_signin_at).getTime()) / (24 * 60 * 60 * 1000))
                        : null,
                },
            });
        }
    }

    if (items.length > 0) {
        await supabase.from("m365_access_review_items").insert(items);
    }
    await supabase.from("m365_access_reviews").update({ item_count: items.length }).eq("id", review.id);

    await supabase.from("activity_logs").insert({
        organization_id: body.organization_id,
        user_id: caller.userId,
        action: "m365_access_review_created",
        resource_type: "m365_access_review",
        resource_id: review.id,
        metadata: { review_kind: body.review_kind, item_count: items.length, due_at },
    });

    return json({ ok: true, review_id: review.id, item_count: items.length }, 200, origin);
});
