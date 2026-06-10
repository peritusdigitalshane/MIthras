// Shared helpers for talking to Microsoft Graph from Mithras edge functions.
//
// Three responsibilities:
//   1. OAuth scope sets — the canonical lists used by start/callback +
//      the "enable remediation" elevated flow. Single source of truth.
//   2. Token refresh against the Azure AD token endpoint.
//   3. Thin Graph fetch wrapper that handles token refresh + throttling.

// ----------------------------------------------------------------------------
// Scope sets
// ----------------------------------------------------------------------------

/** Read-only scopes — the default consent we ask customers to grant. */
export const READ_ONLY_SCOPES = [
    // OIDC scopes — REQUIRED so Microsoft returns an id_token from the
    // v2.0 token endpoint. Without these the response has no id_token,
    // and the callback can't extract the tenant GUID (tid claim) → it
    // bails with missing_tenant_id.
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    // Sign-in + audit logs (Entra ID)
    "AuditLog.Read.All",
    "Directory.Read.All",
    // Mailbox rules (per-user inbox rules via Mail.Read scope and
    // Exchange Online MailboxSettings.Read for the rules collection).
    "MailboxSettings.Read",
    // OAuth grants enumeration
    "Application.Read.All",
    // Risk events
    "IdentityRiskEvent.Read.All",
    // Authorization / Conditional Access policies (user-consent, legacy-auth controls).
    "Policy.Read.All",
    // SharePoint tenant settings (external sharing posture control).
    "SharePointTenantSettings.Read.All",
    // Secure Score (governance posture control).
    "SecurityEvents.Read.All",
    // userRegistrationDetails report (MFA coverage posture control).
    // Replaces the now-deprecated credentialUserRegistrationDetails endpoint.
    "Reports.Read.All",
];

/** Additional scopes granted by the opt-in remediation consent flow. */
export const REMEDIATION_SCOPES = [
    "MailboxSettings.ReadWrite",   // disable a forwarding rule
    "Directory.ReadWrite.All",     // revoke role assignments
    "Application.ReadWrite.All",   // revoke OAuth grants
    "User.RevokeSessions.All",     // force re-MFA / kill sessions
];

// ----------------------------------------------------------------------------
// Token refresh
// ----------------------------------------------------------------------------

interface RefreshResult {
    access_token: string;
    expires_in: number;          // seconds
    refresh_token?: string;      // sometimes rotated, sometimes not
    scope?: string;
}

/**
 * Exchange a refresh_token for a fresh access token. Microsoft may also
 * rotate the refresh token in the response — when they do, we have to
 * persist the new one.
 */
export async function refreshAccessToken(opts: {
    authority: string;
    tenantId: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    scopes: string[];
}): Promise<RefreshResult> {
    const tokenUrl = `${opts.authority}/${opts.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id:      opts.clientId,
        client_secret:  opts.clientSecret,
        grant_type:     "refresh_token",
        refresh_token:  opts.refreshToken,
        scope:          opts.scopes.join(" "),
    });
    const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`token_refresh_failed:${resp.status}:${text.slice(0, 256)}`);
    }
    const json = await resp.json();
    return {
        access_token:  json.access_token,
        expires_in:    json.expires_in,
        refresh_token: json.refresh_token,
        scope:         json.scope,
    };
}

/** Exchange an auth code for tokens — used by the OAuth callback. */
export async function exchangeAuthCode(opts: {
    authority: string;
    tenantId: string;            // 'common' for multi-tenant
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    scopes: string[];
}): Promise<RefreshResult & { id_token?: string }> {
    const tokenUrl = `${opts.authority}/${opts.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id:     opts.clientId,
        client_secret: opts.clientSecret,
        grant_type:    "authorization_code",
        code:          opts.code,
        redirect_uri:  opts.redirectUri,
        scope:         opts.scopes.join(" "),
    });
    const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`code_exchange_failed:${resp.status}:${text.slice(0, 512)}`);
    }
    return await resp.json();
}

// ----------------------------------------------------------------------------
// Graph fetch wrapper
// ----------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export async function graphFetch(
    accessToken: string,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
    const headers = new Headers(init.headers ?? {});
    headers.set("authorization", `Bearer ${accessToken}`);
    if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    return await fetch(url, { ...init, headers });
}

/**
 * Convenience: GET JSON and assert a 2xx. Returns parsed body or throws
 * with the Graph error code/message included.
 *
 * Built-in single retry on 429 (rate limit) and 503 (service unavailable)
 * — Microsoft Graph throttles at modest QPS per tenant and per IP. The
 * retry honours the Retry-After header (capped at 30s so a single tenant
 * can't stall the whole poll). After one retry, the error propagates and
 * the per-tenant poll marks last_poll_error.
 */
export async function graphGetJson<T = unknown>(
    accessToken: string,
    path: string,
): Promise<T> {
    let r = await graphFetch(accessToken, path);
    if (r.status === 429 || r.status === 503) {
        const wait = Math.min(parseInt(r.headers.get("Retry-After") ?? "10", 10) || 10, 30);
        await new Promise((res) => setTimeout(res, wait * 1000));
        r = await graphFetch(accessToken, path);
    }
    if (!r.ok) {
        const text = await r.text();
        throw new Error(`graph_${r.status}:${path}:${text.slice(0, 256)}`);
    }
    return await r.json() as T;
}

/**
 * Iterate every page of a $top-paginated Graph collection. Yields the
 * `.value` array of each page. Stops at `maxPages` (default 50, which is
 * 50 × ~999 entries on Graph audit endpoints).
 */
export async function* graphPaged<T = unknown>(
    accessToken: string,
    path: string,
    maxPages = 50,
): AsyncGenerator<T[]> {
    let next: string | null = path;
    let pages = 0;
    while (next && pages < maxPages) {
        const json = await graphGetJson<{ value: T[]; "@odata.nextLink"?: string }>(
            accessToken, next,
        );
        yield json.value ?? [];
        next = json["@odata.nextLink"] ?? null;
        pages++;
    }
}

// ----------------------------------------------------------------------------
// Detection helpers — shared between poller and DB triggers
// ----------------------------------------------------------------------------

/** Test whether an email address is "external" relative to a tenant's domains. */
export function isExternalAddress(address: string, tenantDomains: string[]): boolean {
    if (!address) return false;
    const at = address.lastIndexOf("@");
    if (at < 0) return false;
    const domain = address.slice(at + 1).toLowerCase();
    return !tenantDomains.some(
        (d) => d.toLowerCase() === domain || domain.endsWith("." + d.toLowerCase()),
    );
}

export const HIGH_RISK_OAUTH_SCOPES = new Set([
    "Mail.ReadWrite", "Mail.Send", "Mail.ReadWrite.All", "Mail.Send.Shared",
    "MailboxSettings.ReadWrite", "full_access_as_app",
    "Files.ReadWrite.All", "Sites.FullControl.All",
    "User.ReadWrite.All", "Directory.ReadWrite.All",
    "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory", "Policy.ReadWrite.ConditionalAccess",
]);

export function highRiskScopesIn(scopeString: string): string[] {
    if (!scopeString) return [];
    return scopeString.split(/\s+/).filter((s) => HIGH_RISK_OAUTH_SCOPES.has(s));
}
