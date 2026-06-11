// POST /functions/v1/m365-poll-tenants
//
// Drives the periodic ingest from Microsoft Graph for every connected M365
// tenant. Called every 5 minutes by pg_cron via pg_net.http_post, and on
// demand from the UI for an individual tenant.
//
// Auth:
//   - x-mithras-poll-secret header (used by pg_cron) — value must match
//     M365_POLL_SECRET env var. OR
//   - Bearer user JWT belonging to an admin of the target org (used by the
//     UI 'Poll now' button)
//
// Body:
//   {}                          → cron mode: poll every tenant with
//                                  consent_state='active'
//   { m365_tenant_id: uuid }   → poll one specific tenant
//
// What it pulls per poll:
//   - Entra ID sign-in events created after last_poll_at (capped at last 1h)
//   - Entra ID directory audit events created after last_poll_at (capped 1h)
//   - For each user who signed in recently: their mailbox inbox rules
//   - All tenant-level OAuth grants (oauth2PermissionGrants)
//
// Detection triggers on the tables do the actual alerting.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import {
    refreshAccessToken,
    graphFetch,
    graphGetJson,
    graphPaged,
    isExternalAddress,
    HIGH_RISK_OAUTH_SCOPES,
    highRiskScopesIn,
    READ_ONLY_SCOPES,
    REMEDIATION_SCOPES,
} from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Fail closed: a missing or weak secret means the cron loop runs
// unauthenticated, and any anonymous caller could trigger Graph polls or
// scan for live tenant IDs. Refuse to start without a real secret.
const POLL_SECRET = Deno.env.get("M365_POLL_SECRET");
if (!POLL_SECRET || POLL_SECRET.length < 16) {
    throw new Error("M365_POLL_SECRET must be set to a random value of at least 16 characters");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

// ----------------------------------------------------------------------------
// Token helpers
// ----------------------------------------------------------------------------

async function getPlatformSetting(key: string): Promise<string> {
    const { data } = await supabase.from("platform_settings")
        .select("value").eq("key", key).maybeSingle();
    return (data?.value ?? "") as string;
}

interface TenantRow {
    id: string;
    organization_id: string;
    tenant_id: string;
    tenant_domain: string | null;
    access_token: string | null;
    access_token_expires_at: string | null;
    refresh_token: string | null;
    scopes: string[];
    remediation_enabled: boolean;
    last_poll_at: string | null;
    signin_audit_supported: boolean;
}

// Graph returns Authentication_RequestFromNonPremiumTenantOrB2CTenant on
// /auditLogs/signIns and /directoryAudits when the tenant lacks Entra ID P1.
function isNonPremiumError(msg: string): boolean {
    return msg.includes("NonPremiumTenant") || msg.includes("NonPremium");
}

async function markSigninAuditUnsupported(tenantId: string): Promise<void> {
    await supabase.from("m365_tenants")
        .update({ signin_audit_supported: false })
        .eq("id", tenantId);
}

async function ensureFreshToken(tenant: TenantRow): Promise<string> {
    const now = Date.now();
    const exp = tenant.access_token_expires_at ? new Date(tenant.access_token_expires_at).getTime() : 0;
    if (tenant.access_token && exp > now + 30_000) return tenant.access_token;

    const clientId     = await getPlatformSetting("m365_azure_client_id");
    const clientSecret = await getPlatformSetting("m365_azure_client_secret");
    const authority    = (await getPlatformSetting("m365_azure_authority")) || "https://login.microsoftonline.com";
    if (!clientId || !clientSecret) throw new Error("m365_credentials_missing");
    if (!tenant.refresh_token) throw new Error("no_refresh_token");

    const scopes = tenant.remediation_enabled
        ? [...READ_ONLY_SCOPES, ...REMEDIATION_SCOPES]
        : READ_ONLY_SCOPES;

    const tok = await refreshAccessToken({
        authority, tenantId: tenant.tenant_id,
        clientId, clientSecret,
        refreshToken: tenant.refresh_token,
        scopes,
    });
    const newExpiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    const patch: Record<string, unknown> = {
        access_token: tok.access_token,
        access_token_expires_at: newExpiresAt,
    };
    if (tok.refresh_token && tok.refresh_token !== tenant.refresh_token) {
        patch.refresh_token = tok.refresh_token;
    }
    await supabase.from("m365_tenants").update(patch).eq("id", tenant.id);
    return tok.access_token;
}

// ----------------------------------------------------------------------------
// Per-tenant poll workflow
// ----------------------------------------------------------------------------

async function pollSignInEvents(tenant: TenantRow, accessToken: string, sinceIso: string): Promise<number> {
    const filter = `createdDateTime ge ${sinceIso}`;
    const path = `/auditLogs/signIns?$filter=${encodeURIComponent(filter)}&$top=200&$orderby=createdDateTime desc`;
    let total = 0;
    try {
        for await (const page of graphPaged<Record<string, unknown>>(accessToken, path, 5)) {
            if (page.length === 0) continue;
            const rows = page.map((e) => ({
                m365_tenant_id:   tenant.id,
                organization_id:  tenant.organization_id,
                graph_event_id:   String(e.id ?? ""),
                user_principal_name: (e.userPrincipalName as string) ?? null,
                user_display_name:   (e.userDisplayName as string) ?? null,
                user_id:             (e.userId as string) ?? null,
                app_display_name:    (e.appDisplayName as string) ?? null,
                client_app_used:     (e.clientAppUsed as string) ?? null,
                ip_address:          (e.ipAddress as string) ?? null,
                country:             (e as { location?: { countryOrRegion?: string } }).location?.countryOrRegion ?? null,
                city:                (e as { location?: { city?: string } }).location?.city ?? null,
                risk_level:          (e.riskLevelDuringSignIn as string) ?? (e.riskLevelAggregated as string) ?? null,
                risk_state:          (e.riskState as string) ?? null,
                risk_event_types:    (e.riskEventTypes as string[]) ?? [],
                status_error_code:   (e as { status?: { errorCode?: number } }).status?.errorCode ?? null,
                status_failure_reason: (e as { status?: { failureReason?: string } }).status?.failureReason ?? null,
                conditional_access_status: (e.conditionalAccessStatus as string) ?? null,
                is_interactive:      (e.isInteractive as boolean) ?? null,
                occurred_at:         String(e.createdDateTime ?? new Date().toISOString()),
                raw_event:           e,
            }));
            const { error } = await supabase
                .from("m365_sign_in_events")
                .upsert(rows, { onConflict: "m365_tenant_id,graph_event_id", ignoreDuplicates: true });
            if (error) throw new Error("signin_upsert:" + error.message);
            total += rows.length;
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Capability flag: a NonPremium 403 means this tenant lacks Entra ID
        // Premium. Persist so future cycles skip the request entirely.
        if (isNonPremiumError(msg)) await markSigninAuditUnsupported(tenant.id);
        // runSection() already prepends the section label (`signins:`) — re-prepending
        // here doubled it (signins:signins:graph_403:…) in last_poll_error and logs.
        throw e instanceof Error ? e : new Error(msg);
    }
    return total;
}

async function pollAuditEvents(tenant: TenantRow, accessToken: string, sinceIso: string): Promise<number> {
    const filter = `activityDateTime ge ${sinceIso}`;
    const path = `/auditLogs/directoryAudits?$filter=${encodeURIComponent(filter)}&$top=200&$orderby=activityDateTime desc`;
    let total = 0;
    try {
        for await (const page of graphPaged<Record<string, unknown>>(accessToken, path, 5)) {
            if (page.length === 0) continue;
            const rows = page.map((e) => {
                const initiatedBy = e.initiatedBy as { user?: { userPrincipalName?: string; id?: string }; app?: { appId?: string; displayName?: string } } | undefined;
                return {
                    m365_tenant_id:   tenant.id,
                    organization_id:  tenant.organization_id,
                    graph_event_id:   String(e.id ?? ""),
                    activity_display_name: (e.activityDisplayName as string) ?? null,
                    category:              (e.category as string) ?? null,
                    operation_type:        (e.operationType as string) ?? null,
                    initiated_by_user_upn: initiatedBy?.user?.userPrincipalName ?? null,
                    initiated_by_user_id:  initiatedBy?.user?.id ?? null,
                    initiated_by_app_id:   initiatedBy?.app?.appId ?? null,
                    initiated_by_app_name: initiatedBy?.app?.displayName ?? null,
                    target_resources:      (e.targetResources as unknown) ?? null,
                    additional_details:    (e.additionalDetails as unknown) ?? null,
                    result:                (e.result as string) ?? null,
                    result_reason:         (e.resultReason as string) ?? null,
                    occurred_at:           String(e.activityDateTime ?? new Date().toISOString()),
                    raw_event:             e,
                };
            });
            const { error } = await supabase
                .from("m365_audit_events")
                .upsert(rows, { onConflict: "m365_tenant_id,graph_event_id", ignoreDuplicates: true });
            if (error) throw new Error("audit_upsert:" + error.message);
            total += rows.length;
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isNonPremiumError(msg)) await markSigninAuditUnsupported(tenant.id);
        // runSection() already prepends the section label — see signins comment above.
        throw e instanceof Error ? e : new Error(msg);
    }
    return total;
}

interface MailboxRule {
    id: string;
    displayName?: string;
    isEnabled?: boolean;
    conditions?: unknown;
    actions?: {
        forwardTo?: Array<{ emailAddress?: { address?: string } }>;
        forwardAsAttachmentTo?: Array<{ emailAddress?: { address?: string } }>;
        redirectTo?: Array<{ emailAddress?: { address?: string } }>;
        moveToFolder?: string;
        delete?: boolean;
    };
}

async function pollMailboxRulesForUser(
    tenant: TenantRow,
    accessToken: string,
    upn: string,
    userId: string,
    tenantDomains: string[],
): Promise<number> {
    const path = `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules`;
    let count = 0;
    try {
        const resp = await graphFetch(accessToken, path);
        if (resp.status === 404 || resp.status === 403) return 0;       // user has no mailbox / no permission
        if (!resp.ok) throw new Error(`graph_${resp.status}`);
        const json = await resp.json() as { value?: MailboxRule[] };
        const rules = json.value ?? [];

        // Mark every rule we currently see as last_seen=now; the rules that
        // disappeared since last poll will keep stale last_seen_at and get
        // marked inactive in a sweep step below.
        const now = new Date().toISOString();
        for (const r of rules) {
            const fwd: string[] = [];
            for (const a of r.actions?.forwardTo ?? []) {
                const addr = a.emailAddress?.address;
                if (addr) fwd.push(addr);
            }
            for (const a of r.actions?.redirectTo ?? []) {
                const addr = a.emailAddress?.address;
                if (addr) fwd.push(addr);
            }
            for (const a of r.actions?.forwardAsAttachmentTo ?? []) {
                const addr = a.emailAddress?.address;
                if (addr) fwd.push(addr);
            }
            const fwdExternal = fwd.some((a) => isExternalAddress(a, tenantDomains));

            const row = {
                m365_tenant_id:        tenant.id,
                organization_id:       tenant.organization_id,
                user_principal_name:   upn,
                user_id:               userId,
                rule_id:               r.id,
                rule_name:             r.displayName ?? null,
                enabled:               r.isEnabled ?? true,
                is_active:             true,
                conditions:            r.conditions ?? null,
                actions:               r.actions ?? null,
                forwards_externally:   fwdExternal,
                forward_to_addresses:  fwd,
                moves_to_folder:       r.actions?.moveToFolder ?? null,
                deletes_messages:      !!r.actions?.delete,
                last_seen_at:          now,
                raw_rule:              r,
            };
            const { error } = await supabase
                .from("m365_mailbox_rules")
                .upsert(row, { onConflict: "m365_tenant_id,user_id,rule_id" });
            if (error) throw new Error("mailbox_upsert:" + error.message);
            count++;
        }
    } catch (e) {
        // One user's mailbox failing shouldn't abort the whole poll.
        console.error(`mailbox_rules user=${upn}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return count;
}

async function pollOAuthGrants(tenant: TenantRow, accessToken: string): Promise<number> {
    let total = 0;
    const now = new Date().toISOString();
    try {
        for await (const page of graphPaged<Record<string, unknown>>(
            accessToken,
            "/oauth2PermissionGrants?$top=200", 5,
        )) {
            if (page.length === 0) continue;
            const rows = page.map((g) => {
                const scope = (g.scope as string) ?? "";
                const matched = highRiskScopesIn(scope);
                return {
                    m365_tenant_id:           tenant.id,
                    organization_id:          tenant.organization_id,
                    grant_id:                 String(g.id ?? ""),
                    client_id:                String(g.clientId ?? ""),
                    client_display_name:      null,            // fetched lazily by UI; saves N requests
                    consent_type:             (g.consentType as string) ?? null,
                    principal_user_id:        (g.principalId as string) ?? null,
                    principal_upn:            null,
                    scope,
                    has_high_risk_scope:      matched.length > 0,
                    high_risk_scopes_matched: matched,
                    last_seen_at:             now,
                    is_active:                true,
                    raw_grant:                g,
                };
            });
            const { error } = await supabase
                .from("m365_oauth_grants")
                .upsert(rows, { onConflict: "m365_tenant_id,grant_id" });
            if (error) throw new Error("oauth_upsert:" + error.message);
            total += rows.length;
        }
    } catch (e) {
        throw new Error(`oauth:${e instanceof Error ? e.message : String(e)}`);
    }
    return total;
}

interface TenantDomain { id: string; isDefault?: boolean }

async function fetchTenantDomains(accessToken: string): Promise<string[]> {
    try {
        const json = await graphGetJson<{ value: TenantDomain[] }>(accessToken, "/domains?$top=100");
        return (json.value ?? []).map((d) => d.id);
    } catch {
        return [];
    }
}

// Pulls displayName + default verified domain in one Graph hop. Used to
// backfill tenant rows where these were never captured at consent time
// (the oauth-callback originally tried to read displayName off the JWT,
// which Azure doesn't populate — so every legacy row has it as null).
async function fetchTenantOrgProfile(accessToken: string): Promise<{ displayName: string | null; defaultDomain: string | null }> {
    try {
        const json = await graphGetJson<{ value: Array<{ displayName?: string; verifiedDomains?: Array<{ name: string; isDefault?: boolean; isInitial?: boolean }> }> }>(
            accessToken, "/organization?$select=displayName,verifiedDomains",
        );
        const row = (json.value ?? [])[0];
        const domains = row?.verifiedDomains ?? [];
        const def = domains.find(d => d.isDefault) ?? domains.find(d => d.isInitial) ?? domains[0];
        return { displayName: row?.displayName ?? null, defaultDomain: def?.name ?? null };
    } catch {
        return { displayName: null, defaultDomain: null };
    }
}

async function uniqueUsersFromSignIns(
    tenantPk: string,
    sinceIso: string,
): Promise<Array<{ upn: string; userId: string }>> {
    const { data } = await supabase
        .from("m365_sign_in_events")
        .select("user_principal_name, user_id")
        .eq("m365_tenant_id", tenantPk)
        .gte("occurred_at", sinceIso)
        .not("user_principal_name", "is", null)
        .not("user_id", "is", null);
    const seen = new Map<string, { upn: string; userId: string }>();
    for (const r of (data ?? [])) {
        const key = r.user_id as string;
        if (!seen.has(key) && r.user_principal_name) {
            seen.set(key, { upn: r.user_principal_name, userId: r.user_id });
        }
    }
    return Array.from(seen.values()).slice(0, 50);          // cap per poll
}

/**
 * Pull users whose mailbox rules we haven't re-checked recently. Closes
 * the "compromised account that never signs in" blind spot — an attacker
 * who creates a forwarding rule via OAuth app or legacy Basic Auth EWS
 * call won't necessarily show up in sign-in logs, but we still need to
 * sweep their rules periodically.
 */
async function staleMailboxUsers(
    tenantPk: string,
    olderThanMs: number,
): Promise<Array<{ upn: string; userId: string }>> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await supabase
        .from("m365_mailbox_rules")
        .select("user_id, user_principal_name")
        .eq("m365_tenant_id", tenantPk)
        .lt("last_seen_at", cutoff)
        .limit(50);
    const seen = new Map<string, { upn: string; userId: string }>();
    for (const r of (data ?? [])) {
        const key = r.user_id as string;
        if (!seen.has(key) && r.user_principal_name) {
            seen.set(key, { upn: r.user_principal_name, userId: r.user_id });
        }
    }
    return Array.from(seen.values());
}

/**
 * First-poll seed: enumerate up to N enabled users from the tenant so we
 * have an initial mailbox-rule baseline even before they sign in. Only
 * runs when last_poll_at is null.
 */
async function seedUsersFirstPoll(
    accessToken: string,
    cap = 50,
): Promise<Array<{ upn: string; userId: string }>> {
    try {
        const json = await graphGetJson<{ value: Array<{ id: string; userPrincipalName?: string; accountEnabled?: boolean }> }>(
            accessToken, `/users?$select=id,userPrincipalName,accountEnabled&$top=${cap}`,
        );
        return (json.value ?? [])
            .filter((u) => u.accountEnabled !== false && u.userPrincipalName)
            .map((u) => ({ upn: u.userPrincipalName!, userId: u.id }));
    } catch {
        return [];
    }
}

/**
 * Run a per-section poller and capture any failure as a short error tag
 * rather than aborting the whole poll. Lets a tenant without Entra ID P1
 * (no sign-in or audit log access) still get mailbox + OAuth coverage.
 */
async function runSection<T>(
    label: string,
    section: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
        return { ok: true, value: await section() };
    } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        console.warn(`m365_section_failed[${label}]`, { error: raw });
        return { ok: false, error: `${label}:${compactGraphError(raw)}` };
    }
}

// Graph errors come through as `graph_NNN:/path?...:{"error":{"code":"XXX",...}}`.
// A dumb head-slice clips the URL and loses the diagnostic code, which prevents
// the UI parser from classifying license-blocked endpoints. Pull the Graph
// status + error code out cleanly and drop the URL — the code is the useful bit.
function compactGraphError(raw: string): string {
    const statusMatch = raw.match(/graph_(\d+)/);
    const codeMatch   = raw.match(/"code"\s*:\s*"([^"]+)"/);
    if (statusMatch && codeMatch) {
        return `graph_${statusMatch[1]}:${codeMatch[1]}`;
    }
    if (statusMatch) {
        return `graph_${statusMatch[1]}`;
    }
    return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
}

async function pollTenant(tenant: TenantRow): Promise<Record<string, unknown>> {
    // Concurrency guard: cron + manual "Poll now" must not both refresh
    // the same tenant's tokens, or one will clobber the other's rotated
    // refresh_token. The advisory lock auto-releases at transaction end.
    const { data: lockOk } = await supabase.rpc(
        "m365_try_lock_tenant", { p_id: tenant.id },
    );
    if (lockOk === false) {
        return { ok: false, tenant_id: tenant.tenant_id, skipped: "concurrent_poll" };
    }

    const isFirstPoll = !tenant.last_poll_at;
    const since = tenant.last_poll_at
        ? new Date(tenant.last_poll_at).toISOString()
        : new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    // Token refresh is the only step that genuinely must succeed — every
    // section needs a valid access token. If that fails, mark + bail.
    let accessToken: string;
    try {
        accessToken = await ensureFreshToken(tenant);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("m365_tenants").update({
            last_poll_error: `token_refresh:${msg.slice(0, 300)}`,
        }).eq("id", tenant.id);
        return { ok: false, tenant_id: tenant.tenant_id, error: `token_refresh:${msg}` };
    }

    const errors: string[] = [];

    // Tenant domains — used by mailbox external-forward classification.
    // A failure here doesn't block anything; downstream sees an empty
    // domain list and classifies overly aggressively, but it's safer to
    // run on degraded data than not run.
    const domains = await fetchTenantDomains(accessToken).catch((e) => {
        errors.push(`domains:${e instanceof Error ? e.message : String(e)}`);
        return [] as string[];
    });

    // Best-effort backfill of tenant_display_name / tenant_domain via
    // /organization. Self-correcting: every poll cycle, an idempotent
    // patch on the row brings stale or never-set values current.
    try {
        const profile = await fetchTenantOrgProfile(accessToken);
        const patch: Record<string, unknown> = {};
        if (profile.displayName)   patch.tenant_display_name = profile.displayName;
        if (profile.defaultDomain) patch.tenant_domain       = profile.defaultDomain;
        if (Object.keys(patch).length > 0) {
            await supabase.from("m365_tenants").update(patch).eq("id", tenant.id);
        }
    } catch (e) {
        errors.push(`org_profile:${e instanceof Error ? e.message : String(e)}`);
    }

    // Each Graph section runs independently. P1-only endpoints
    // (signins / directoryAudits) fail with Authentication_RequestFromNonPremiumTenantOrB2
    // on tenants without Entra ID Premium; the first time that happens we
    // persist signin_audit_supported=false and skip these two requests
    // thereafter — both to spare the noisy 5-min warn log and to save a
    // Graph round-trip per cycle. Flip the column back to true to re-probe
    // after a Premium upgrade.
    const signinResult = tenant.signin_audit_supported
        ? await runSection("signins", () => pollSignInEvents(tenant, accessToken, since))
        : { ok: true as const, value: 0 };
    const auditResult  = tenant.signin_audit_supported
        ? await runSection("audit",   () => pollAuditEvents(tenant, accessToken, since))
        : { ok: true as const, value: 0 };

    // Mailbox-rule sweep user list — only consult sign-in events if we
    // actually got any. Otherwise fall back to stale + first-poll seed.
    const signInUsers = signinResult.ok
        ? await uniqueUsersFromSignIns(tenant.id, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        : [];
    const staleUsers = await staleMailboxUsers(tenant.id, 48 * 60 * 60 * 1000);
    const seedUsers = isFirstPoll
        ? await seedUsersFirstPoll(accessToken, 50).catch(() => [])
        : [];

    const userMap = new Map<string, { upn: string; userId: string }>();
    for (const u of [...signInUsers, ...staleUsers, ...seedUsers]) {
        if (!userMap.has(u.userId)) userMap.set(u.userId, u);
    }
    // Per-cycle sweep cap. Was 100 which at Graph's default 5 RPS produces
    // a ~20-second sequential tail per large tenant and stacks across all
    // tenants in the cron run. With staleMailboxUsers feeding rotation,
    // 25 per cycle still covers a 100-user tenant every 4 polls.
    const MAILBOX_USERS_PER_CYCLE = 25;
    const users = Array.from(userMap.values()).slice(0, MAILBOX_USERS_PER_CYCLE);

    const mailboxResult = await runSection("mailbox", async () => {
        let n = 0;
        for (const u of users) {
            n += await pollMailboxRulesForUser(tenant, accessToken, u.upn, u.userId, domains);
            // Small inter-call breather — Graph's per-tenant throttle is
            // 10k requests / 10 min but bursts of ~100 in a tight loop
            // can still trip the per-user mailbox API limiter.
            await new Promise((r) => setTimeout(r, 60));
        }
        return n;
    });

    const oauthResult = await runSection("oauth", () => pollOAuthGrants(tenant, accessToken));

    for (const r of [signinResult, auditResult, mailboxResult, oauthResult]) {
        if (!r.ok) errors.push(r.error);
    }

    await supabase.from("m365_tenants").update({
        last_poll_at: new Date().toISOString(),
        last_poll_error: errors.length === 0 ? null : errors.join("; ").slice(0, 1000),
    }).eq("id", tenant.id);

    return {
        ok: errors.length === 0,
        tenant_id: tenant.tenant_id,
        sign_ins:      !tenant.signin_audit_supported
            ? "no_premium"
            : signinResult.ok ? signinResult.value : "skipped",
        audit_events:  !tenant.signin_audit_supported
            ? "no_premium"
            : auditResult.ok ? auditResult.value : "skipped",
        mailbox_rules: mailboxResult.ok ? mailboxResult.value : "skipped",
        oauth_grants:  oauthResult.ok  ? oauthResult.value  : "skipped",
        users_swept:   users.length,
        first_poll:    isFirstPoll,
        errors:        errors.length > 0 ? errors : undefined,
    };
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

async function isAuthorisedUserForTenant(jwt: string, tenantPk: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return false;
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (isSuper) return true;
    const { data: tenantRow } = await supabase
        .from("m365_tenants").select("organization_id").eq("id", tenantPk).maybeSingle();
    if (!tenantRow) return false;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", {
        _user_id: user.id, _org_id: tenantRow.organization_id,
    });
    return !!isAdmin;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const cronSecret = req.headers.get("x-mithras-poll-secret") ?? "";
    const isCron = POLL_SECRET && cronSecret === POLL_SECRET;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const targetTenantPk = body.m365_tenant_id ? String(body.m365_tenant_id) : null;

    if (!isCron) {
        const authHeader = req.headers.get("Authorization") ?? "";
        const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!jwt) return jsonResponse({ error: "missing_token" }, 401, origin);
        if (!targetTenantPk) return jsonResponse({ error: "m365_tenant_id_required" }, 400, origin);
        const ok = await isAuthorisedUserForTenant(jwt, targetTenantPk);
        if (!ok) return jsonResponse({ error: "forbidden" }, 403, origin);
    }

    // Build tenant list.
    let tenants: TenantRow[];
    if (targetTenantPk) {
        const { data } = await supabase
            .from("m365_tenants")
            .select("id,organization_id,tenant_id,tenant_domain,access_token,access_token_expires_at,refresh_token,scopes,remediation_enabled,last_poll_at,signin_audit_supported")
            .eq("id", targetTenantPk).eq("consent_state", "active").maybeSingle();
        if (!data) return jsonResponse({ error: "tenant_not_found_or_inactive" }, 404, origin);
        tenants = [data as TenantRow];
    } else {
        const { data } = await supabase
            .from("m365_tenants")
            .select("id,organization_id,tenant_id,tenant_domain,access_token,access_token_expires_at,refresh_token,scopes,remediation_enabled,last_poll_at,signin_audit_supported")
            .eq("consent_state", "active");
        tenants = (data ?? []) as TenantRow[];
    }

    const results = [];
    for (const t of tenants) {
        results.push(await pollTenant(t));
    }

    return jsonResponse({ ok: true, polled: results.length, results }, 200, origin);
});
