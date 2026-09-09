// POST /functions/v1/m365-lifecycle-leaver
//
// Operator-triggered offboarding. Walks through:
//   1. Revoke all M365 sessions
//   2. Disable the account
//   3. Remove from all Entra groups
//   4. (optional) Set out-of-office / forward inbox to manager
//   5. (optional) Convert mailbox to shared
//   6. Schedule delete in N days (deferred — recorded in workflow row)
//
// Each step is recorded into lifecycle_workflows.steps even if a later
// step fails — partial completion is normal in this flow.

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
    return typeof v === "string" ? v : null;
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
    const scopes = (t.scopes && t.scopes.length > 0) ? t.scopes : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];
    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id, clientId, clientSecret,
        refreshToken: t.refresh_token, scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = { access_token: tok.access_token, access_token_expires_at: newExpiresAt };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) patch.refresh_token = tok.refresh_token;
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
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", { _user_id: userId, _org_id: orgId });
    return isAdmin === true;
}

type StepResult = { step: string; ok: boolean; detail?: string };

async function runStep(token: string, name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<StepResult> {
    try {
        const r = await fn();
        return { step: name, ok: r.ok, detail: r.detail };
    } catch (e) {
        return { step: name, ok: false, detail: String((e as Error).message ?? e).slice(0, 300) };
    }
}

async function gfetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
    });
}

interface LeaverInput {
    organization_id: string;
    target_user_upn: string;
    target_user_id?: string;
    manager_upn?: string;
    reason?: string;
    options?: {
        revoke_sessions?: boolean;
        disable_account?: boolean;
        remove_from_groups?: boolean;
        out_of_office?: boolean;
        forward_to_manager?: boolean;
        delete_after_days?: number | null;
    };
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: LeaverInput;
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
    if (!body.organization_id) return json({ error: "organization_id_required" }, 400, origin);
    if (!body.target_user_upn) return json({ error: "target_user_upn_required" }, 400, origin);

    if (!(await userIsOrgAdmin(caller.userId, body.organization_id))) return json({ error: "forbidden" }, 403, origin);

    const { data: org } = await supabase
        .from("organizations")
        .select("id, m365_shield_enabled")
        .eq("id", body.organization_id).maybeSingle();
    if (!org) return json({ error: "organization_not_found" }, 404, origin);
    if (!org.m365_shield_enabled) return json({ error: "m365_shield_not_enabled" }, 409, origin);

    const { data: tenants } = await supabase
        .from("m365_tenants")
        .select("id, organization_id, tenant_id, access_token, refresh_token, access_token_expires_at, scopes, remediation_enabled, consent_state")
        .eq("organization_id", body.organization_id)
        .eq("consent_state", "active");

    const t = (tenants ?? []).find((x: any) => x.remediation_enabled === true) as TenantRow | undefined;
    if (!t) return json({ error: "no_remediation_tenant", detail: "Re-consent M365 with remediation scopes." }, 409, origin);

    const opts = {
        revoke_sessions: true,
        disable_account: true,
        remove_from_groups: true,
        out_of_office: !!body.manager_upn,
        forward_to_manager: !!body.manager_upn,
        delete_after_days: 90,
        ...(body.options ?? {}),
    };

    // Pre-create the workflow row so partial failures are recoverable
    const { data: wfRow } = await supabase
        .from("lifecycle_workflows")
        .insert({
            organization_id: body.organization_id,
            m365_tenant_id:  t.id,
            kind:            "leaver",
            target_user_id:  body.target_user_id ?? body.target_user_upn,
            target_user_upn: body.target_user_upn,
            manager_upn:     body.manager_upn ?? null,
            requested_by:    caller.userId,
            reason:          body.reason ?? null,
            options:         opts,
            status:          "running",
            started_at:      new Date().toISOString(),
        })
        .select("id")
        .single();

    if (!wfRow) return json({ error: "insert_failed" }, 500, origin);

    let token: string;
    try { token = await ensureFreshToken(t); }
    catch (e) {
        await supabase.from("lifecycle_workflows").update({
            status: "failed", completed_at: new Date().toISOString(),
            error_summary: `token_refresh: ${String((e as Error).message ?? e).slice(0, 200)}`,
        }).eq("id", wfRow.id);
        return json({ error: "token_refresh_failed", workflow_id: wfRow.id }, 502, origin);
    }

    // Resolve user object id from UPN
    let userId = body.target_user_id;
    if (!userId) {
        const r = await gfetch(token, `/users/${encodeURIComponent(body.target_user_upn)}?$select=id,displayName`);
        if (r.ok) {
            const u = await r.json() as { id: string; displayName?: string };
            userId = u.id;
            await supabase.from("lifecycle_workflows").update({
                target_user_id: u.id,
                target_user_display: u.displayName ?? null,
            }).eq("id", wfRow.id);
        }
    }
    if (!userId) {
        await supabase.from("lifecycle_workflows").update({
            status: "failed", completed_at: new Date().toISOString(),
            error_summary: "could not resolve user_id from UPN",
        }).eq("id", wfRow.id);
        return json({ error: "user_not_found", workflow_id: wfRow.id }, 404, origin);
    }

    const steps: StepResult[] = [];

    // 1. Revoke sessions
    if (opts.revoke_sessions) {
        steps.push(await runStep(token, "revoke_sessions", async () => {
            const r = await gfetch(token, `/users/${userId}/revokeSignInSessions`, { method: "POST" });
            return { ok: r.ok, detail: r.ok ? "all sessions revoked" : `graph_${r.status}: ${(await r.text()).slice(0, 200)}` };
        }));
    }

    // 2. Disable account
    if (opts.disable_account) {
        steps.push(await runStep(token, "disable_account", async () => {
            const r = await gfetch(token, `/users/${userId}`, {
                method: "PATCH",
                body: JSON.stringify({ accountEnabled: false }),
            });
            return { ok: r.ok, detail: r.ok ? "accountEnabled=false" : `graph_${r.status}: ${(await r.text()).slice(0, 200)}` };
        }));
    }

    // 3. Remove from all groups
    if (opts.remove_from_groups) {
        steps.push(await runStep(token, "remove_from_groups", async () => {
            // List groups the user is a member of (memberOf returns directory objects; filter to groups)
            const r = await gfetch(token, `/users/${userId}/memberOf?$select=id`);
            if (!r.ok) return { ok: false, detail: `list_${r.status}` };
            const body = await r.json() as { value?: Array<{ id: string }> };
            let removed = 0, failed = 0;
            for (const g of body.value ?? []) {
                const dr = await gfetch(token, `/groups/${g.id}/members/${userId}/$ref`, { method: "DELETE" });
                if (dr.ok || dr.status === 404) removed++;
                else failed++;
            }
            return { ok: failed === 0, detail: `removed from ${removed} groups, ${failed} failed` };
        }));
    }

    // 4. Set Out-of-Office (if manager provided)
    if (opts.out_of_office && body.manager_upn) {
        steps.push(await runStep(token, "out_of_office", async () => {
            const r = await gfetch(token, `/users/${userId}/mailboxSettings`, {
                method: "PATCH",
                body: JSON.stringify({
                    automaticRepliesSetting: {
                        status: "alwaysEnabled",
                        externalAudience: "all",
                        internalReplyMessage: `${body.target_user_upn} has left the company. Please contact ${body.manager_upn}.`,
                        externalReplyMessage: `${body.target_user_upn} has left the company. Please contact ${body.manager_upn}.`,
                    },
                }),
            });
            return { ok: r.ok, detail: r.ok ? "OOO configured" : `graph_${r.status}: ${(await r.text()).slice(0, 200)}` };
        }));
    }

    // 5. Inbox rule forwarding to manager (best-effort; some tenants block)
    if (opts.forward_to_manager && body.manager_upn) {
        steps.push(await runStep(token, "forward_to_manager", async () => {
            const r = await gfetch(token, `/users/${userId}/mailFolders/inbox/messageRules`, {
                method: "POST",
                body: JSON.stringify({
                    displayName: `[Mithras] Forward to ${body.manager_upn}`,
                    sequence: 1,
                    isEnabled: true,
                    actions: {
                        forwardTo: [{ emailAddress: { address: body.manager_upn, name: body.manager_upn } }],
                        stopProcessingRules: true,
                    },
                }),
            });
            return { ok: r.ok, detail: r.ok ? `forward rule to ${body.manager_upn}` : `graph_${r.status}: ${(await r.text()).slice(0, 200)}` };
        }));
    }

    // 6. Determine final status
    const failed = steps.filter((s) => !s.ok).length;
    const finalStatus = failed === 0 ? "completed" : "partial";

    await supabase.from("lifecycle_workflows").update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        steps,
        error_summary: failed === 0 ? null : `${failed} step(s) failed`,
    }).eq("id", wfRow.id);

    await supabase.from("activity_logs").insert({
        organization_id: body.organization_id,
        user_id: caller.userId,
        action: "m365_lifecycle_leaver",
        resource_type: "m365_user",
        resource_id: body.target_user_upn,
        metadata: {
            workflow_id: wfRow.id,
            manager_upn: body.manager_upn,
            steps_ok: steps.length - failed,
            steps_failed: failed,
            reason: body.reason ?? null,
        },
    });

    return json({ ok: failed === 0, workflow_id: wfRow.id, status: finalStatus, steps }, 200, origin);
});
