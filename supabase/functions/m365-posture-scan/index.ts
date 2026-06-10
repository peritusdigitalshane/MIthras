// POST /functions/v1/m365-posture-scan
//
// Runs Mithras' M365 security posture audit against one tenant. Polls
// Microsoft Graph for ~8 high-signal controls (MFA coverage, legacy auth,
// admin sprawl, OAuth grants, sharing settings, Secure Score, etc.), scores
// each, and writes a snapshot + per-control finding to the DB.
//
// Two invocation modes:
//   Body { tenant_id: uuid }    — scan a specific m365_tenants row (called
//                                  by the UI "Run scan now" button or by
//                                  daily cron iterating active tenants)
//   Body { all: true }          — iterate all active tenants (cron path)
//
// Auth:
//   - UI call: bearer JWT, super-admin OR admin of the tenant's org
//   - Cron call: service-role bearer
//
// Returns: { snapshot_id, overall_score, pass_count, warn_count, fail_count }
//          or { error } on failure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { graphGetJson, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const AZURE_CLIENT_ID       = Deno.env.get("AZURE_CLIENT_ID") ?? "";
const AZURE_CLIENT_SECRET   = Deno.env.get("AZURE_CLIENT_SECRET") ?? "";
const AZURE_AUTHORITY       = Deno.env.get("AZURE_AUTHORITY") ?? "https://login.microsoftonline.com";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// ----------------------------------------------------------------------------
// Token freshness: refresh if <5 min until expiry. Updates DB row.
// ----------------------------------------------------------------------------
async function ensureFreshToken(tenantRow: any): Promise<string> {
    const expiresAt = tenantRow.access_token_expires_at ? new Date(tenantRow.access_token_expires_at).getTime() : 0;
    if (tenantRow.access_token && expiresAt - Date.now() > 5 * 60_000) {
        return tenantRow.access_token;
    }
    if (!tenantRow.refresh_token) throw new Error("no_refresh_token");
    if (!AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) throw new Error("azure_credentials_not_configured");

    const refreshed = await refreshAccessToken({
        tenantId:     tenantRow.tenant_id,
        clientId:     AZURE_CLIENT_ID,
        clientSecret: AZURE_CLIENT_SECRET,
        refreshToken: tenantRow.refresh_token,
        authority:    AZURE_AUTHORITY,
    });

    await admin.from("m365_tenants").update({
        access_token:            refreshed.access_token,
        access_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        refresh_token:           refreshed.refresh_token ?? tenantRow.refresh_token,
    }).eq("id", tenantRow.id);

    return refreshed.access_token;
}

// ----------------------------------------------------------------------------
// Control implementations. Each returns { status, score, details, error }.
//
// Score is 0-100 for the control in isolation. Status buckets:
//   pass   — score >= 80
//   warn   — score 40-79
//   fail   — score < 40
//   error  — Graph call blew up (insufficient scope, throttling, etc.)
//   skipped — control intentionally not evaluated for this tenant
// ----------------------------------------------------------------------------

type Finding = {
    control_id: string;
    status: "pass" | "warn" | "fail" | "error" | "skipped";
    score: number;
    details: Record<string, unknown>;
    error_message?: string;
};

// Classify a thrown Graph error into a "skipped" finding when the failure
// is environmental (missing scope, no premium license, deprecated
// endpoint) rather than a Mithras bug. This stops the M365 posture page
// going red on customers who just haven't granted the optional scopes or
// don't have Entra ID P1.
//
// Returns a skipped Finding when classification matched, or null to fall
// back to the generic "error" status.
function classifyGraphFailure(controlId: string, err: unknown): Finding | null {
    const msg = errMsg(err);

    // Entra ID P1 / P2 required
    if (/RequestFromNonPremiumTenantOrB2CTenant|Authentication_RequestFromNonPremiumTenantOrB2CTenant/i.test(msg)) {
        return {
            control_id: controlId,
            status: "skipped",
            score: 0,
            details: {
                reason: "requires_entra_id_p1",
                hint: "This control reads a Microsoft Graph endpoint that requires Entra ID P1 on the customer's tenant. The other controls keep running.",
            },
        };
    }

    // Missing application permission (operator must add scope to the app
    // registration + re-consent). Error shape varies: 403 with
    // Authorization_RequestDenied, accessDenied, "required scopes are missing",
    // or "Auth token does not contain valid permissions".
    if (/Authorization_RequestDenied|accessDenied|AccessDenied|required scopes are missing|does not contain valid permissions/i.test(msg)) {
        const missing = guessMissingScope(controlId, msg);
        return {
            control_id: controlId,
            status: "skipped",
            score: 0,
            details: {
                reason: "missing_app_permission",
                missing_scope: missing,
                hint: missing
                    ? `Add the ${missing} application permission to the Mithras app registration in Azure AD → API permissions, then click Grant admin consent.`
                    : "The Mithras app registration is missing a Graph permission needed for this control. Open Azure AD → App registrations → Mithras → API permissions and re-grant admin consent.",
            },
        };
    }

    return null;
}

function guessMissingScope(controlId: string, _msg: string): string | null {
    switch (controlId) {
        case "apps.user_consent_disabled":         return "Policy.Read.All";
        case "identity.legacy_auth_blocked":       return "Policy.Read.All";
        case "data.sharepoint_external_sharing":   return "SharePointTenantSettings.Read.All";
        case "governance.secure_score":            return "SecurityEvents.Read.All";
        case "identity.mfa_coverage":              return "Reports.Read.All";
        default:                                   return null;
    }
}

async function checkMfaCoverage(token: string): Promise<Finding> {
    try {
        // Per-user MFA state. The old /reports/credentialUserRegistrationDetails
        // endpoint was retired by Microsoft in 2024 — it now 400s with
        // "Resource not found for the segment 'credentialUserRegistrationDetails'".
        // The replacement is /reports/authenticationMethods/userRegistrationDetails
        // which exposes the same isMfaRegistered field plus richer
        // method-level data.
        const data = await graphGetJson<{ value: any[] }>(
            token,
            "/reports/authenticationMethods/userRegistrationDetails?$top=999",
        );
        const users = data.value ?? [];
        if (users.length === 0) {
            return { control_id: "identity.mfa_coverage", status: "skipped", score: 0, details: { reason: "no_users_returned" } };
        }
        const enrolled = users.filter(u => u.isMfaRegistered === true).length;
        const coveragePct = Math.round((enrolled / users.length) * 100);
        const status = coveragePct >= 95 ? "pass" : coveragePct >= 75 ? "warn" : "fail";
        const score  = coveragePct;
        return {
            control_id: "identity.mfa_coverage",
            status,
            score,
            details: {
                total_users: users.length,
                mfa_registered: enrolled,
                coverage_pct: coveragePct,
                holdouts_sample: users.filter(u => !u.isMfaRegistered).slice(0, 10).map(u => u.userPrincipalName),
            },
        };
    } catch (e) {
        return classifyGraphFailure("identity.mfa_coverage", e)
            ?? { control_id: "identity.mfa_coverage", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkLegacyAuthBlocked(token: string): Promise<Finding> {
    try {
        const data = await graphGetJson<{ value: any[] }>(
            token,
            "/identity/conditionalAccess/policies?$top=200",
        );
        const policies = data.value ?? [];
        // Find any *enabled* policy that blocks the legacy-auth client app
        // filters: exchangeActiveSync + other.
        const blocking = policies.find(p =>
            (p.state === "enabled") &&
            (p.grantControls?.builtInControls ?? []).includes("block") &&
            (p.conditions?.clientAppTypes ?? []).some((c: string) =>
                c === "exchangeActiveSync" || c === "other"
            )
        );
        if (blocking) {
            return {
                control_id: "identity.legacy_auth_blocked",
                status: "pass",
                score: 100,
                details: { policy_name: blocking.displayName, policy_id: blocking.id },
            };
        }
        return {
            control_id: "identity.legacy_auth_blocked",
            status: "fail",
            score: 0,
            details: {
                policy_count: policies.length,
                hint: "No enabled Conditional Access policy was found that blocks legacy authentication.",
            },
        };
    } catch (e) {
        return classifyGraphFailure("identity.legacy_auth_blocked", e)
            ?? { control_id: "identity.legacy_auth_blocked", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkGlobalAdminCount(token: string): Promise<Finding> {
    try {
        // Built-in Global Administrator role template ID.
        const ROLE_ID = "62e90394-69f5-4237-9190-012177145e10";
        // Directory role must be activated; query directoryRoles for the activated instance.
        const roles = await graphGetJson<{ value: any[] }>(
            token,
            "/directoryRoles?$filter=roleTemplateId eq '" + ROLE_ID + "'",
        );
        const role = roles.value?.[0];
        if (!role) {
            return {
                control_id: "identity.global_admin_count",
                status: "skipped",
                score: 0,
                details: { reason: "global_admin_role_not_activated" },
            };
        }
        // Graph's /directoryRoles/{id}/members rejects $top with
        // Request_UnsupportedQuery (400) — "This resource does not
        // support custom page sizes". Use the default page size; a
        // Global Administrator role having more than the default
        // (100) members is a deeply broken tenant and we'd flag it
        // anyway, so we don't bother paginating.
        const members = await graphGetJson<{ value: any[] }>(
            token,
            `/directoryRoles/${role.id}/members`,
        );
        const count = members.value?.length ?? 0;
        // Best practice: 2-4 global admins. >5 is warn, >8 is fail. 0 or 1 also fail (no break-glass).
        let status: Finding["status"] = "pass";
        let score = 100;
        if (count <= 1)       { status = "fail"; score = 30; }
        else if (count <= 4)  { status = "pass"; score = 100; }
        else if (count <= 8)  { status = "warn"; score = 60; }
        else                  { status = "fail"; score = 20; }
        return {
            control_id: "identity.global_admin_count",
            status,
            score,
            details: {
                global_admin_count: count,
                recommended_range: "2-4 (one cloud-only break-glass + working admins)",
                sample: (members.value ?? []).slice(0, 10).map(m => m.userPrincipalName ?? m.displayName),
            },
        };
    } catch (e) {
        return classifyGraphFailure("identity.global_admin_count", e)
            ?? { control_id: "identity.global_admin_count", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkGuestSprawl(token: string): Promise<Finding> {
    try {
        const data = await graphGetJson<{ value: any[] }>(
            token,
            "/users?$filter=userType eq 'Guest'&$select=id,displayName,userPrincipalName,signInActivity,createdDateTime&$top=200",
        );
        const guests = data.value ?? [];
        const now = Date.now();
        const stale = guests.filter(g => {
            const last = g.signInActivity?.lastSignInDateTime
                ? new Date(g.signInActivity.lastSignInDateTime).getTime()
                : 0;
            return now - last > 90 * 24 * 60 * 60 * 1000;
        });
        const stalePct = guests.length === 0 ? 0 : Math.round((stale.length / guests.length) * 100);
        // Few guests + low stale-pct = pass. Lots of stale = fail.
        let status: Finding["status"] = "pass";
        let score = 100;
        if (stale.length === 0)         { status = "pass"; score = 100; }
        else if (stalePct < 25)         { status = "warn"; score = 70; }
        else if (stalePct < 50)         { status = "warn"; score = 50; }
        else                            { status = "fail"; score = 30; }
        return {
            control_id: "identity.guest_user_sprawl",
            status,
            score,
            details: {
                total_guests: guests.length,
                stale_90d_count: stale.length,
                stale_pct: stalePct,
                stale_sample: stale.slice(0, 10).map(g => g.userPrincipalName ?? g.displayName),
            },
        };
    } catch (e) {
        return classifyGraphFailure("identity.guest_user_sprawl", e)
            ?? { control_id: "identity.guest_user_sprawl", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkUserConsentDisabled(token: string): Promise<Finding> {
    try {
        const data = await graphGetJson<any>(token, "/policies/authorizationPolicy");
        // permissionGrantPolicyIdsAssignedToDefaultUserRole: empty array == users cannot consent.
        const defaultGrants: string[] = data.defaultUserRolePermissions?.permissionGrantPoliciesAssigned ?? data.permissionGrantPolicyIdsAssignedToDefaultUserRole ?? [];
        const isBlocked = !defaultGrants || defaultGrants.length === 0;
        return {
            control_id: "apps.user_consent_disabled",
            status: isBlocked ? "pass" : "fail",
            score:  isBlocked ? 100 : 0,
            details: {
                granted_policies: defaultGrants,
                hint: isBlocked
                    ? "User app consent is blocked tenant-wide."
                    : "Users can grant their own consent — switch this off and enable the admin consent workflow.",
            },
        };
    } catch (e) {
        return classifyGraphFailure("apps.user_consent_disabled", e)
            ?? { control_id: "apps.user_consent_disabled", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

const HIGH_RISK_APP_PERMS = new Set([
    "Mail.ReadWrite", "Mail.Read.All", "Files.ReadWrite.All", "Sites.ReadWrite.All",
    "User.ReadWrite.All", "Group.ReadWrite.All", "Directory.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory", "AppRoleAssignment.ReadWrite.All",
]);

async function checkRiskyOauthGrants(token: string): Promise<Finding> {
    try {
        const data = await graphGetJson<{ value: any[] }>(
            token,
            "/oauth2PermissionGrants?$top=500",
        );
        const grants = data.value ?? [];
        const risky: any[] = [];
        for (const g of grants) {
            const scopes = (g.scope ?? "").split(/\s+/).filter(Boolean);
            const hits = scopes.filter((s: string) => HIGH_RISK_APP_PERMS.has(s));
            if (hits.length > 0) {
                risky.push({ client_id: g.clientId, principal: g.principalId, scopes: hits });
            }
        }
        let status: Finding["status"] = "pass";
        let score = 100;
        if (risky.length === 0)         { status = "pass"; score = 100; }
        else if (risky.length <= 2)     { status = "warn"; score = 70; }
        else if (risky.length <= 5)     { status = "warn"; score = 50; }
        else                            { status = "fail"; score = 20; }
        return {
            control_id: "apps.risky_oauth_grants",
            status,
            score,
            details: {
                total_grants: grants.length,
                risky_count: risky.length,
                risky_sample: risky.slice(0, 10),
            },
        };
    } catch (e) {
        return classifyGraphFailure("apps.risky_oauth_grants", e)
            ?? { control_id: "apps.risky_oauth_grants", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkSharepointSharing(token: string): Promise<Finding> {
    try {
        // Tenant-level SharePoint settings via Graph.
        const data = await graphGetJson<any>(token, "/admin/sharepoint/settings");
        const setting = data.sharingCapability ?? "unknown";
        // disabled / existingExternalUserSharingOnly / externalUserSharingOnly / externalUserAndGuestSharing
        let status: Finding["status"];
        let score: number;
        switch (setting) {
            case "disabled":                          status = "pass"; score = 100; break;
            case "existingExternalUserSharingOnly":   status = "pass"; score = 90;  break;
            case "externalUserSharingOnly":           status = "warn"; score = 60;  break;
            case "externalUserAndGuestSharing":       status = "fail"; score = 20;  break;
            default:                                  status = "warn"; score = 50;  break;
        }
        return {
            control_id: "data.sharepoint_external_sharing",
            status,
            score,
            details: {
                sharing_capability: setting,
                one_drive: data.oneDriveSharingCapability,
                hint: "\"externalUserAndGuestSharing\" = anyone-with-link is allowed. Tighten to \"existingExternalUserSharingOnly\" or stricter.",
            },
        };
    } catch (e) {
        return classifyGraphFailure("data.sharepoint_external_sharing", e)
            ?? { control_id: "data.sharepoint_external_sharing", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkSecureScore(token: string): Promise<Finding & { secure_current?: number; secure_max?: number }> {
    try {
        const data = await graphGetJson<{ value: any[] }>(
            token,
            "/security/secureScores?$top=1",
        );
        const latest = data.value?.[0];
        if (!latest) {
            return {
                control_id: "governance.secure_score",
                status: "skipped",
                score: 0,
                details: { reason: "no_secure_score_data" },
            };
        }
        const pct = latest.maxScore > 0 ? Math.round((latest.currentScore / latest.maxScore) * 100) : 0;
        let status: Finding["status"] = "pass";
        if (pct < 50)        status = "fail";
        else if (pct < 75)   status = "warn";
        return {
            control_id: "governance.secure_score",
            status,
            score: pct,
            details: {
                current_score: latest.currentScore,
                max_score:     latest.maxScore,
                pct,
                comparative_average: latest.averageComparativeScores?.find((c: any) => c.basis === "AllTenants")?.averageScore,
                active_user_count: latest.activeUserCount,
            },
            secure_current: latest.currentScore,
            secure_max:     latest.maxScore,
        };
    } catch (e) {
        return classifyGraphFailure("governance.secure_score", e)
            ?? { control_id: "governance.secure_score", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkExternalForwardingBlocked(token: string): Promise<Finding> {
    try {
        // Remote-domain default policy tells us whether external auto-forwarding
        // is allowed tenant-wide. AutoForwardEnabled = false means blocked at
        // transport. Falls back to anti-phishing outbound policy if Remote
        // Domain query fails (some tenants only expose security/policy paths).
        const data = await graphGetJson<any>(token, "/admin/exchange/remoteDomains/Default").catch(() => null);
        if (data && typeof data.autoForwardEnabled === "boolean") {
            const blocked = data.autoForwardEnabled === false;
            return {
                control_id: "email.external_forwarding_blocked",
                status: blocked ? "pass" : "fail",
                score: blocked ? 100 : 10,
                details: {
                    source: "remoteDomains.Default",
                    auto_forward_enabled: data.autoForwardEnabled,
                    hint: blocked
                        ? "External auto-forwarding is blocked at the Remote Domain default policy."
                        : "External auto-forwarding is currently permitted. This is the #1 BEC persistence vector — disable it.",
                },
            };
        }
        // Soft skip if Graph doesn't expose it — Mithras can't determine policy.
        return {
            control_id: "email.external_forwarding_blocked",
            status: "skipped",
            score: 0,
            details: { reason: "exchange_remote_domain_endpoint_unavailable", hint: "Mithras couldn't read the Remote Domain default policy via Graph. Check manually in Exchange admin centre → Mail flow → Remote domains." },
        };
    } catch (e) {
        return classifyGraphFailure("email.external_forwarding_blocked", e)
            ?? { control_id: "email.external_forwarding_blocked", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkStaleAppRegistrations(token: string): Promise<Finding> {
    try {
        // Custom apps (non-Microsoft) registered in this tenant.
        const apps = await graphGetJson<{ value: any[] }>(
            token,
            "/applications?$top=500&$select=id,displayName,createdDateTime,signInAudience",
        );
        const total = apps.value?.length ?? 0;
        if (total === 0) {
            return {
                control_id: "apps.stale_app_registrations",
                status: "pass",
                score: 100,
                details: { total_apps: 0, hint: "No custom app registrations." },
            };
        }
        // Service principal sign-in activity tells us recency. We probe up to
        // 200 service principals to keep the call bounded.
        const sps = await graphGetJson<{ value: any[] }>(
            token,
            "/servicePrincipals?$top=500&$select=id,appId,signInAudience,createdDateTime",
        ).catch(() => ({ value: [] }));
        // Build appId → most-recent-known-activity (createdDateTime as proxy
        // when sign-in audit is not available without ID Premium).
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const stale = apps.value.filter(a => {
            const created = a.createdDateTime ? new Date(a.createdDateTime).getTime() : 0;
            return created < ninetyDaysAgo;
        });
        // We can't reliably know "no sign-in for 90 days" without ID P1 — use
        // age-since-creation as a soft proxy. If >25% of apps are >90d old AND
        // we have many apps, flag warn; >50% = fail.
        const stalePct = Math.round((stale.length / total) * 100);
        let status: Finding["status"] = "pass";
        let score = 100;
        if (stalePct >= 50)        { status = "fail"; score = 30; }
        else if (stalePct >= 25)   { status = "warn"; score = 60; }
        return {
            control_id: "apps.stale_app_registrations",
            status,
            score,
            details: {
                total_apps:       total,
                stale_count:      stale.length,
                stale_pct:        stalePct,
                service_principals: sps.value?.length ?? 0,
                hint: "We approximate \"stale\" as age-since-registration > 90 days. With Entra ID P1 you can see actual last-sign-in dates per app.",
                sample: stale.slice(0, 10).map(a => ({ name: a.displayName, created: a.createdDateTime })),
            },
        };
    } catch (e) {
        return classifyGraphFailure("apps.stale_app_registrations", e)
            ?? { control_id: "apps.stale_app_registrations", status: "error", score: 0, details: {}, error_message: errMsg(e) };
    }
}

async function checkAuditLogEnabled(token: string): Promise<Finding> {
    try {
        // Probe the audit log endpoint — if logging is enabled and our token
        // has the scope, this returns 200 with a (possibly empty) collection.
        // If logging is disabled tenant-wide, Graph returns 400/403 with a
        // specific error code.
        const r = await graphGetJson<any>(token, "/auditLogs/signIns?$top=1");
        // Any successful response means audit logging is on AND we can read it.
        return {
            control_id: "governance.audit_log_enabled",
            status: "pass",
            score: 100,
            details: {
                hint: "Unified audit log is enabled and Mithras can read it.",
                sample_count: r?.value?.length ?? 0,
            },
        };
    } catch (e) {
        const msg = errMsg(e);
        if (/auditLog|MailboxNotEnabledForRESTAPI|disabled|400|403/i.test(msg)) {
            return {
                control_id: "governance.audit_log_enabled",
                status: "fail",
                score: 0,
                details: {
                    hint: "Audit log appears disabled OR the consent doesn't include AuditLog.Read.All. Without this, you have no forensic trail.",
                    error: msg.slice(0, 200),
                },
            };
        }
        return classifyGraphFailure("governance.audit_log_enabled", e)
            ?? { control_id: "governance.audit_log_enabled", status: "error", score: 0, details: {}, error_message: msg };
    }
}

function errMsg(e: unknown): string {
    if (e instanceof Error) return e.message.slice(0, 500);
    return String(e).slice(0, 500);
}

// ----------------------------------------------------------------------------
// Scan one tenant.
// ----------------------------------------------------------------------------
async function scanTenant(tenantRowId: string, triggeredBy: string | null): Promise<{ snapshot_id: string; overall_score: number; pass_count: number; warn_count: number; fail_count: number; error_count: number } | { error: string }> {
    const startedAt = Date.now();

    const { data: tenantRow, error: tErr } = await admin
        .from("m365_tenants")
        .select("*")
        .eq("id", tenantRowId)
        .maybeSingle();
    if (tErr || !tenantRow) return { error: "tenant_not_found" };
    if (tenantRow.consent_state !== "active") return { error: `tenant_consent_${tenantRow.consent_state}` };

    let token: string;
    try {
        token = await ensureFreshToken(tenantRow);
    } catch (e) {
        // Persist a snapshot row so the UI knows the scan was attempted.
        const { data: snap } = await admin.from("m365_posture_snapshots").insert({
            organization_id: tenantRow.organization_id,
            m365_tenant_id:  tenantRow.id,
            scan_error:      errMsg(e),
            triggered_by:    triggeredBy,
        }).select().single();
        return { error: errMsg(e), snapshot_id: (snap as any)?.id ?? "" } as any;
    }

    // Run all controls in parallel — they're independent Graph calls.
    const results = await Promise.all([
        checkMfaCoverage(token),
        checkLegacyAuthBlocked(token),
        checkGlobalAdminCount(token),
        checkGuestSprawl(token),
        checkUserConsentDisabled(token),
        checkRiskyOauthGrants(token),
        checkSharepointSharing(token),
        checkSecureScore(token),
        checkExternalForwardingBlocked(token),
        checkStaleAppRegistrations(token),
        checkAuditLogEnabled(token),
    ]);

    // Look up control weights to compute the overall weighted score.
    const { data: controls } = await admin
        .from("m365_posture_controls")
        .select("control_id, weight");
    const weightMap = new Map<string, number>();
    for (const c of (controls ?? [])) weightMap.set(c.control_id, c.weight);

    let weightedSum = 0;
    let weightTotal = 0;
    let passCount = 0, warnCount = 0, failCount = 0, errorCount = 0;
    for (const r of results) {
        const w = weightMap.get(r.control_id) ?? 5;
        if (r.status === "error" || r.status === "skipped") {
            errorCount += r.status === "error" ? 1 : 0;
            continue;
        }
        weightedSum += r.score * w;
        weightTotal += 100 * w;
        if (r.status === "pass") passCount++;
        else if (r.status === "warn") warnCount++;
        else if (r.status === "fail") failCount++;
    }
    const overallScore = weightTotal === 0 ? null : Math.round((weightedSum / weightTotal) * 100);
    const secureScoreFinding = results.find(r => r.control_id === "governance.secure_score") as any;

    // Persist snapshot + findings.
    const { data: snap, error: snapErr } = await admin.from("m365_posture_snapshots").insert({
        organization_id:   tenantRow.organization_id,
        m365_tenant_id:    tenantRow.id,
        scanned_at:        new Date().toISOString(),
        overall_score:     overallScore,
        secure_score:      secureScoreFinding?.secure_current ?? null,
        secure_score_max:  secureScoreFinding?.secure_max ?? null,
        pass_count:        passCount,
        warn_count:        warnCount,
        fail_count:        failCount,
        error_count:       errorCount,
        scan_duration_ms:  Date.now() - startedAt,
        triggered_by:      triggeredBy,
    }).select().single();
    if (snapErr || !snap) return { error: snapErr?.message ?? "snapshot_insert_failed" };

    const findingRows = results.map(r => ({
        snapshot_id:   (snap as any).id,
        control_id:    r.control_id,
        status:        r.status,
        score:         r.score,
        details:       r.details,
        error_message: r.error_message ?? null,
    }));
    await admin.from("m365_posture_findings").insert(findingRows);

    // Update tenant row with last poll info so other surfaces know we scanned.
    await admin.from("m365_tenants").update({
        last_poll_at:    new Date().toISOString(),
        last_poll_error: null,
    }).eq("id", tenantRow.id);

    return {
        snapshot_id:   (snap as any).id,
        overall_score: overallScore ?? 0,
        pass_count:    passCount,
        warn_count:    warnCount,
        fail_count:    failCount,
        error_count:   errorCount,
    };
}

// ----------------------------------------------------------------------------
// HTTP entry
// ----------------------------------------------------------------------------
Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    let body: { tenant_id?: string; all?: boolean } = {};
    try { body = await req.json(); } catch {}

    // Authn: either a user JWT (UI-initiated) or service-role (cron).
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "auth_required" }, 401, origin);

    const isServiceRole = token === SUPABASE_SERVICE_KEY;
    let triggeredBy: string | null = null;

    if (!isServiceRole) {
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userData, error: userErr } = await userClient.auth.getUser();
        if (userErr || !userData?.user) return json({ error: "auth_invalid" }, 401, origin);
        triggeredBy = userData.user.id;
    }

    // Path 1: scan all active tenants (cron mode)
    if (body.all === true) {
        if (!isServiceRole) return json({ error: "service_role_required_for_bulk" }, 403, origin);
        const { data: tenants } = await admin
            .from("m365_tenants")
            .select("id, organization_id")
            .eq("consent_state", "active");
        const results: any[] = [];
        for (const t of (tenants ?? [])) {
            const r = await scanTenant(t.id, null);
            results.push({ tenant_id: t.id, ...r });
        }
        return json({ scanned: results.length, results }, 200, origin);
    }

    // Path 2: scan a single tenant
    if (!body.tenant_id) return json({ error: "tenant_id_required" }, 400, origin);

    // Permission check for UI calls
    if (!isServiceRole) {
        const { data: row } = await admin
            .from("m365_tenants")
            .select("organization_id")
            .eq("id", body.tenant_id)
            .maybeSingle();
        if (!row) return json({ error: "tenant_not_found" }, 404, origin);

        const { data: isSuper } = await admin.from("super_admins").select("user_id").eq("user_id", triggeredBy!).maybeSingle();
        if (!isSuper) {
            const { data: isAdminRow } = await admin
                .from("organization_memberships")
                .select("role")
                .eq("user_id", triggeredBy!)
                .eq("organization_id", row.organization_id)
                .in("role", ["admin", "owner"])
                .maybeSingle();
            if (!isAdminRow) return json({ error: "forbidden_admin_only" }, 403, origin);
        }
    }

    const result = await scanTenant(body.tenant_id, triggeredBy);
    if ("error" in result && !("snapshot_id" in result)) {
        return json(result, 500, origin);
    }
    return json(result, 200, origin);
});
