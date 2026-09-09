// POST /functions/v1/m365-access-review-enforce
//
// Two modes:
//   - Single item:  body { item_id, decision: 'keep'|'remove' }
//                   Records the decision; if 'remove', enforces via Graph.
//   - Whole review: body { review_id }
//                   For every item with decision='remove' and not yet enforced,
//                   enforce via Graph.
//
// Enforcement per review_kind:
//   admin: DELETE every roleAssignment for this user
//   guest: DELETE /users/{id}    (removes the guest user from the directory)
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
    remediation_enabled: boolean;
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

async function enforceItem(item: any, accessToken: string, reviewKind: string): Promise<{ ok: boolean; detail?: string }> {
    if (reviewKind === "admin") {
        // List role assignments for principalId=subject_id, then DELETE each.
        const r = await fetch(
            `https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments?$filter=principalId eq '${item.subject_id}'`,
            { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) },
        );
        if (!r.ok) return { ok: false, detail: `list_${r.status}: ${(await r.text()).slice(0, 200)}` };
        const body = await r.json() as { value?: Array<{ id: string }> };
        for (const ra of body.value ?? []) {
            const dr = await fetch(
                `https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments/${ra.id}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) },
            );
            if (!dr.ok && dr.status !== 404) {
                return { ok: false, detail: `delete_${dr.status}: ${(await dr.text()).slice(0, 200)}` };
            }
        }
        return { ok: true };
    }
    if (reviewKind === "guest") {
        const dr = await fetch(
            `https://graph.microsoft.com/v1.0/users/${item.subject_id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) },
        );
        if (!dr.ok && dr.status !== 404) {
            return { ok: false, detail: `delete_${dr.status}: ${(await dr.text()).slice(0, 200)}` };
        }
        return { ok: true };
    }
    return { ok: false, detail: "unsupported_review_kind" };
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: { item_id?: string; decision?: string; review_id?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }

    // Single-item path
    if (body.item_id) {
        if (body.decision && !["keep", "remove"].includes(body.decision)) {
            return json({ error: "decision_invalid" }, 400, origin);
        }
        const { data: item } = await supabase
            .from("m365_access_review_items")
            .select("*, review:m365_access_reviews!inner(id, organization_id, review_kind, m365_tenant_id)")
            .eq("id", body.item_id)
            .maybeSingle();
        if (!item) return json({ error: "item_not_found" }, 404, origin);

        const orgId = (item.review as any).organization_id as string;
        if (!(await userIsOrgAdmin(caller.userId, orgId))) return json({ error: "forbidden" }, 403, origin);

        // Always record the decision.
        await supabase.from("m365_access_review_items").update({
            decision:    body.decision ?? null,
            decided_at:  body.decision ? new Date().toISOString() : null,
            decided_by:  body.decision ? caller.userId : null,
        }).eq("id", body.item_id);

        // If decision is 'remove' and not yet enforced → enforce now.
        if (body.decision === "remove" && !item.enforced_at) {
            const { data: t } = await supabase
                .from("m365_tenants")
                .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes, remediation_enabled")
                .eq("id", (item.review as any).m365_tenant_id)
                .maybeSingle();
            if (!t) return json({ error: "tenant_missing" }, 404, origin);
            if (!t.remediation_enabled) return json({ error: "remediation_not_enabled" }, 409, origin);

            let token: string;
            try { token = await ensureFreshToken(t as TenantRow); }
            catch (e) { return json({ error: "token_refresh_failed", detail: String((e as Error).message ?? e).slice(0, 200) }, 502, origin); }

            const res = await enforceItem(item, token, (item.review as any).review_kind);
            await supabase.from("m365_access_review_items").update({
                enforced_at:        res.ok ? new Date().toISOString() : null,
                enforcement_error:  res.ok ? null : res.detail ?? "unknown",
            }).eq("id", body.item_id);
            if (res.ok) {
                // Update rollup counts on the review row.
                const { data: cnt } = await supabase
                    .from("m365_access_review_items")
                    .select("decision, enforced_at")
                    .eq("review_id", (item.review as any).id);
                const kept    = (cnt ?? []).filter((i: any) => i.decision === "keep").length;
                const removed = (cnt ?? []).filter((i: any) => i.decision === "remove" && i.enforced_at).length;
                await supabase.from("m365_access_reviews").update({ kept_count: kept, removed_count: removed }).eq("id", (item.review as any).id);
            }
            return json({ ok: res.ok, detail: res.detail }, res.ok ? 200 : 502, origin);
        }
        return json({ ok: true }, 200, origin);
    }

    // Bulk enforce path
    if (body.review_id) {
        const { data: review } = await supabase
            .from("m365_access_reviews")
            .select("id, organization_id, review_kind, m365_tenant_id")
            .eq("id", body.review_id)
            .maybeSingle();
        if (!review) return json({ error: "review_not_found" }, 404, origin);
        if (!(await userIsOrgAdmin(caller.userId, review.organization_id))) return json({ error: "forbidden" }, 403, origin);

        const { data: t } = await supabase
            .from("m365_tenants")
            .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes, remediation_enabled")
            .eq("id", review.m365_tenant_id)
            .maybeSingle();
        if (!t) return json({ error: "tenant_missing" }, 404, origin);
        if (!t.remediation_enabled) return json({ error: "remediation_not_enabled" }, 409, origin);

        let token: string;
        try { token = await ensureFreshToken(t as TenantRow); }
        catch (e) { return json({ error: "token_refresh_failed", detail: String((e as Error).message ?? e).slice(0, 200) }, 502, origin); }

        const { data: items } = await supabase
            .from("m365_access_review_items")
            .select("*")
            .eq("review_id", review.id)
            .eq("decision", "remove")
            .is("enforced_at", null);

        let ok = 0, failed = 0;
        for (const it of items ?? []) {
            const res = await enforceItem(it, token, review.review_kind);
            await supabase.from("m365_access_review_items").update({
                enforced_at:       res.ok ? new Date().toISOString() : null,
                enforcement_error: res.ok ? null : res.detail ?? "unknown",
            }).eq("id", it.id);
            if (res.ok) ok++; else failed++;
        }

        const { data: cnt } = await supabase
            .from("m365_access_review_items")
            .select("decision, enforced_at")
            .eq("review_id", review.id);
        const kept    = (cnt ?? []).filter((i: any) => i.decision === "keep").length;
        const removed = (cnt ?? []).filter((i: any) => i.decision === "remove" && i.enforced_at).length;
        const everyoneDecided = (cnt ?? []).every((i: any) => i.decision !== null);
        await supabase.from("m365_access_reviews").update({
            kept_count: kept,
            removed_count: removed,
            completed_at: everyoneDecided ? new Date().toISOString() : null,
            completed_by: everyoneDecided ? caller.userId : null,
        }).eq("id", review.id);

        await supabase.from("activity_logs").insert({
            organization_id: review.organization_id,
            user_id: caller.userId,
            action: "m365_access_review_enforced",
            resource_type: "m365_access_review",
            resource_id: review.id,
            metadata: { ok, failed, kept, removed },
        });

        return json({ ok: true, succeeded: ok, failed }, 200, origin);
    }

    return json({ error: "item_id_or_review_id_required" }, 400, origin);
});
