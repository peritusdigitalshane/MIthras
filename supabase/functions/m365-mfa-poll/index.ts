// POST /functions/v1/m365-mfa-poll
//
// For each shielded M365 tenant, pull /reports/authenticationMethods/userRegistrationDetails
// and upsert into m365_mfa_coverage. Also pulls /directoryRoles + members to
// flag admins so the dashboard can break down coverage by privilege class.
//
// Spec: docs/superpowers/specs/2026-06-18-mithras-m365-shield.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

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
    tenant_pk: string;
    organization_id: string;
    tenant_id: string;
    tenant_display_name: string | null;
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

    const scopes = (t.scopes && t.scopes.length > 0) ? t.scopes : [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES];
    const tok = await refreshAccessToken({
        authority, tenantId: t.tenant_id, clientId, clientSecret,
        refreshToken: t.refresh_token, scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = { access_token: tok.access_token, access_token_expires_at: newExpiresAt };
    if (tok.refresh_token && tok.refresh_token !== t.refresh_token) patch.refresh_token = tok.refresh_token;
    await supabase.from("m365_tenants").update(patch as any).eq("id", t.tenant_pk);
    return tok.access_token;
}

interface UserRegDetails {
    id: string;
    userPrincipalName: string;
    userDisplayName?: string;
    isMfaCapable?: boolean;
    isMfaRegistered?: boolean;
    isPasswordlessCapable?: boolean;
    isSsprCapable?: boolean;
    isSsprRegistered?: boolean;
    isSsprEnabled?: boolean;
    methodsRegistered?: string[];
    defaultMfaMethod?: string;
    lastUpdatedDateTime?: string;
}

interface DirectoryRole {
    id: string;
    displayName: string;
    roleTemplateId: string;
}

interface RoleMember {
    id: string;
    userPrincipalName?: string;
}

async function fetchAllPages<T>(token: string, url: string, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = url;
    let pages = 0;
    while (next && pages < maxPages) {
        const r = await fetch(next, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(25_000),
        });
        if (!r.ok) {
            throw new Error(`graph_${r.status}:${url}:${(await r.text()).slice(0, 200)}`);
        }
        const body = await r.json() as { value?: T[]; "@odata.nextLink"?: string };
        if (body.value) out.push(...body.value);
        next = body["@odata.nextLink"] ?? null;
        pages++;
    }
    return out;
}

// FREE-tier MFA detection: enumerate users, then per-user authentication
// methods. This works on any tenant — no Entra ID P1 required.
//
// Method types we treat as "MFA-registered":
//   - microsoftAuthenticatorAuthenticationMethod
//   - softwareOathAuthenticationMethod
//   - phoneAuthenticationMethod
//   - fido2AuthenticationMethod
//   - windowsHelloForBusinessAuthenticationMethod
//   - temporaryAccessPassAuthenticationMethod
//   - emailAuthenticationMethod (technically MFA-eligible)
// Method types that do NOT count as MFA:
//   - passwordAuthenticationMethod (it's the first factor)

interface GraphUser { id: string; userPrincipalName: string; displayName?: string }
interface GraphAuthMethod { "@odata.type": string; id: string }

const PASSWORDLESS_METHODS = new Set([
    "#microsoft.graph.fido2AuthenticationMethod",
    "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod",
    "#microsoft.graph.temporaryAccessPassAuthenticationMethod",
]);
const MFA_METHODS = new Set([
    "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
    "#microsoft.graph.softwareOathAuthenticationMethod",
    "#microsoft.graph.phoneAuthenticationMethod",
    "#microsoft.graph.emailAuthenticationMethod",
    ...PASSWORDLESS_METHODS,
]);

function shortMethodLabel(odataType: string): string {
    return odataType
        .replace("#microsoft.graph.", "")
        .replace(/AuthenticationMethod$/, "");
}

class ScopeMissingError extends Error {
    constructor(public scope: string, public sample: string) {
        super(`missing_scope:${scope}`);
    }
}

async function fallbackPerUserMfa(token: string): Promise<UserRegDetails[]> {
    // Pull tenant users
    const users = await fetchAllPages<GraphUser>(
        token,
        "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,displayName&$top=200",
    );
    if (users.length === 0) return [];

    // Probe with the first user BEFORE fanning out. If the tenant hasn't
    // granted UserAuthenticationMethod.Read.All, every per-user call will
    // 403 — better to fail loud once than silently record every user as
    // "no MFA registered" (the false-negative bug we just fixed).
    const probe = await fetch(
        `https://graph.microsoft.com/v1.0/users/${users[0].id}/authentication/methods`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(15_000) },
    );
    if (probe.status === 403) {
        const sample = (await probe.text()).slice(0, 300);
        throw new ScopeMissingError("UserAuthenticationMethod.Read.All", sample);
    }
    if (!probe.ok) {
        throw new Error(`probe_${probe.status}:${(await probe.text()).slice(0, 200)}`);
    }
    // Probe succeeded — process the first user's body alongside the rest.
    const probeBody = await probe.json() as { value?: GraphAuthMethod[] };

    const out: UserRegDetails[] = [];

    function classify(u: GraphUser, body: { value?: GraphAuthMethod[] }): UserRegDetails {
        const types = (body.value ?? []).map(m => m["@odata.type"]).filter(Boolean);
        const mfaTypes = types.filter(t => MFA_METHODS.has(t));
        const passwordless = types.some(t => PASSWORDLESS_METHODS.has(t));
        return {
            id: u.id, userPrincipalName: u.userPrincipalName, userDisplayName: u.displayName,
            isMfaCapable: mfaTypes.length > 0,
            isMfaRegistered: mfaTypes.length > 0,
            isPasswordlessCapable: passwordless,
            methodsRegistered: mfaTypes.map(shortMethodLabel),
            defaultMfaMethod: mfaTypes[0] ? shortMethodLabel(mfaTypes[0]) : undefined,
        };
    }

    out.push(classify(users[0], probeBody));

    // Bounded concurrency: 8 in-flight to keep tenant-side throttling sane.
    const remaining = users.slice(1);
    const failures: Array<{ id: string; status: number; msg: string }> = [];
    const concurrency = 8;
    let idx = 0;
    async function worker() {
        while (idx < remaining.length) {
            const my = idx++;
            const u = remaining[my];
            try {
                const r = await fetch(
                    `https://graph.microsoft.com/v1.0/users/${u.id}/authentication/methods`,
                    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                      signal: AbortSignal.timeout(15_000) },
                );
                if (!r.ok) {
                    failures.push({ id: u.id, status: r.status, msg: (await r.text()).slice(0, 100) });
                    // Mark this single user "unknown" rather than guess
                    out.push({ id: u.id, userPrincipalName: u.userPrincipalName, userDisplayName: u.displayName,
                               isMfaCapable: false, isMfaRegistered: false, methodsRegistered: [] });
                    continue;
                }
                const body = await r.json() as { value?: GraphAuthMethod[] };
                out.push(classify(u, body));
            } catch (e) {
                failures.push({ id: u.id, status: 0, msg: String((e as Error).message ?? e).slice(0, 100) });
                out.push({ id: u.id, userPrincipalName: u.userPrincipalName, userDisplayName: u.displayName,
                           isMfaCapable: false, isMfaRegistered: false, methodsRegistered: [] });
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // If >25% of users failed in a way that suggests scope/permission issues
    // (403 / 401), promote it to a tenant-level failure so the operator sees
    // it instead of trusting a half-empty dataset.
    const authFailures = failures.filter(f => f.status === 401 || f.status === 403).length;
    if (authFailures > 0 && authFailures > users.length * 0.25) {
        throw new ScopeMissingError(
            "UserAuthenticationMethod.Read.All",
            `${authFailures} of ${users.length} users returned 401/403 — Mithras has lost its grant or the scope wasn't fully consented.`,
        );
    }
    return out;
}

async function pollTenant(t: TenantRow): Promise<{ ok: boolean; users: number; admins: number; error?: string; via?: string; requires_consent?: boolean; note?: string; missing_scope?: string }> {
    let token: string;
    try { token = await ensureFreshToken(t); }
    catch (e) { return { ok: false, users: 0, admins: 0, error: `token: ${String((e as Error).message ?? e).slice(0, 200)}` }; }

    // 1. Pull MFA registration details. Try the premium endpoint first; on
    //    403 with the well-known "non-premium tenant" code, fall back to
    //    per-user enumeration which works on any tenant.
    let reg: UserRegDetails[];
    let via = "premium_report";
    try {
        reg = await fetchAllPages<UserRegDetails>(
            token,
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=200",
        );
    } catch (e) {
        const msg = String((e as Error).message ?? e);
        const isPremiumBlock = /graph_403/.test(msg) && /Authentication_RequestFromNonPremiumTenantOrB2CTenant/.test(msg);
        if (!isPremiumBlock) {
            return { ok: false, users: 0, admins: 0, error: msg.slice(0, 200) };
        }
        // Free-tier fallback
        try {
            reg = await fallbackPerUserMfa(token);
            via = "per_user_methods";
        } catch (e2) {
            if (e2 instanceof ScopeMissingError) {
                return {
                    ok: false, users: 0, admins: 0,
                    requires_consent: true,
                    missing_scope: e2.scope,
                    note: `MFA coverage needs the '${e2.scope}' Microsoft Graph permission. Reconnect this M365 tenant to grant it. Microsoft returned: ${e2.sample.slice(0, 120)}`,
                };
            }
            return { ok: false, users: 0, admins: 0, error: `fallback_failed:${String((e2 as Error).message ?? e2).slice(0, 200)}` };
        }
    }

    // 2. Pull directory roles and their members so we can flag admins.
    let roles: DirectoryRole[] = [];
    try {
        roles = await fetchAllPages<DirectoryRole>(token, "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,roleTemplateId");
    } catch {
        // Continue without admin flagging; users still get logged
    }

    const adminUserToRoles = new Map<string, string[]>();
    for (const role of roles) {
        try {
            const members = await fetchAllPages<RoleMember>(
                token,
                `https://graph.microsoft.com/v1.0/directoryRoles/${role.id}/members?$select=id,userPrincipalName`,
                10,
            );
            for (const m of members) {
                const list = adminUserToRoles.get(m.id) ?? [];
                list.push(role.displayName);
                adminUserToRoles.set(m.id, list);
            }
        } catch { continue; }
    }

    // 3. Upsert
    const now = new Date().toISOString();
    let admins = 0;
    const rows = reg.map((u) => {
        const adminRoles = adminUserToRoles.get(u.id) ?? [];
        const isAdmin = adminRoles.length > 0;
        if (isAdmin) admins++;
        return {
            organization_id:         t.organization_id,
            m365_tenant_id:          t.tenant_pk,
            user_id:                 u.id,
            user_upn:                u.userPrincipalName,
            display_name:            u.userDisplayName ?? null,
            is_mfa_capable:          !!u.isMfaCapable,
            is_mfa_registered:       !!u.isMfaRegistered,
            is_passwordless_capable: !!u.isPasswordlessCapable,
            is_sspr_capable:         !!u.isSsprCapable,
            is_sspr_registered:      !!u.isSsprRegistered,
            is_sspr_enabled:         !!u.isSsprEnabled,
            methods_registered:      u.methodsRegistered ?? [],
            primary_method:          u.defaultMfaMethod ?? null,
            is_admin:                isAdmin,
            admin_roles:             adminRoles,
            last_evaluated_at:       now,
        };
    });

    if (rows.length > 0) {
        // Chunk to avoid request size limits on big tenants
        for (let i = 0; i < rows.length; i += 100) {
            const chunk = rows.slice(i, i + 100);
            const { error } = await supabase
                .from("m365_mfa_coverage")
                .upsert(chunk, { onConflict: "m365_tenant_id,user_id" });
            if (error) {
                return { ok: false, users: rows.length, admins, error: `upsert: ${error.message}` };
            }
        }
    }

    return { ok: true, users: rows.length, admins, via };
}

async function authorise(req: Request): Promise<boolean> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt && jwt === SUPABASE_SERVICE_KEY) return true;
    return false;
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);
    if (!(await authorise(req))) return json({ error: "unauthorized" }, 401, origin);

    const { data: tenants, error } = await supabase.rpc("shielded_m365_tenants");
    if (error) return json({ error: "tenants_query_failed", detail: error.message }, 500, origin);

    const results: Array<{ tenant: string; ok: boolean; users: number; admins: number; error?: string; via?: string; requires_consent?: boolean; missing_scope?: string; note?: string }> = [];
    for (const t of (tenants ?? []) as TenantRow[]) {
        const tenantLabel = (t.tenant_display_name && t.tenant_display_name !== "None")
            ? t.tenant_display_name
            : (t as any).tenant_domain || t.tenant_id || "(unnamed tenant)";
        try {
            const r = await pollTenant(t);
            results.push({ tenant: tenantLabel, ...r });
        } catch (e) {
            results.push({
                tenant: tenantLabel,
                ok: false, users: 0, admins: 0,
                error: String((e as Error).message ?? e).slice(0, 200),
            });
        }
    }

    return json({ ok: true, tenants: results.length, results }, 200, origin);
});
