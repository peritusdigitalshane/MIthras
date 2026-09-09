// POST /functions/v1/m365-sharing-poll
//
// For each shielded M365 tenant, walk the user OneDrives + top SharePoint
// sites, enumerate file/folder permissions, flag external + anonymous +
// suspicious-domain shares, upsert into m365_shared_items.
//
// Cron: daily 02:13 UTC. Substitutes Purview DLP external sharing reports
// for SMBs without an E5 add-on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { READ_ONLY_SCOPES, REMEDIATION_SCOPES, refreshAccessToken } from "../_shared/m365-graph.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Domains where a share is automatically "high risk" — adversary geographies,
// recent attacker infrastructure, common phishing/typosquat TLDs.
const SUSPICIOUS_TLDS = [".ru", ".cn", ".kp", ".ir", ".click", ".tk", ".gq", ".cf"];

// Cap per-tenant items processed in a single run to keep this within edge
// runtime limits. Big tenants get walked over multiple days.
const MAX_USERS_PER_RUN = 50;
const MAX_SITES_PER_RUN = 20;
const MAX_ITEMS_PER_DRIVE = 500;

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

async function graphGet<T>(token: string, url: string): Promise<T | null> {
    try {
        const r = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) return null;
        return await r.json() as T;
    } catch { return null; }
}

interface OrgDomain { id: string; isDefault?: boolean; }
async function fetchTenantDomains(token: string): Promise<string[]> {
    const body = await graphGet<{ value?: OrgDomain[] }>(token, "https://graph.microsoft.com/v1.0/domains?$select=id,isDefault");
    return (body?.value ?? []).map((d) => d.id.toLowerCase());
}

interface UserBrief { id: string; userPrincipalName?: string; displayName?: string; }
async function fetchUsers(token: string, limit: number): Promise<UserBrief[]> {
    const body = await graphGet<{ value?: UserBrief[] }>(
        token,
        `https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,displayName&$top=${Math.min(limit, 200)}`,
    );
    return (body?.value ?? []).slice(0, limit);
}

interface SiteBrief { id: string; displayName?: string; webUrl?: string; }
async function fetchTopSites(token: string, limit: number): Promise<SiteBrief[]> {
    // Use search endpoint to get the top sites — works for delegated tokens.
    const body = await graphGet<{ value?: SiteBrief[] }>(
        token,
        `https://graph.microsoft.com/v1.0/sites?search=*&$top=${Math.min(limit, 50)}`,
    );
    return (body?.value ?? []).slice(0, limit);
}

interface DriveItem {
    id: string;
    name?: string;
    webUrl?: string;
    size?: number;
    lastModifiedDateTime?: string;
    folder?: unknown;
    file?: unknown;
    parentReference?: { path?: string };
    shared?: unknown;
}

interface Permission {
    id: string;
    link?: { scope?: string; type?: string; webUrl?: string };
    grantedTo?: { user?: { email?: string; displayName?: string; id?: string } };
    grantedToV2?: { user?: { email?: string; displayName?: string; id?: string }; siteUser?: { email?: string; displayName?: string } };
    invitation?: { email?: string; signInRequired?: boolean };
    inheritedFrom?: unknown;
    expirationDateTime?: string;
    grantedDateTime?: string;
    roles?: string[];
}

function permissionRecipient(p: Permission): { email: string | null; display: string | null } {
    const u = p.grantedToV2?.user ?? p.grantedTo?.user ?? null;
    const inv = p.invitation;
    const email = u?.email ?? inv?.email ?? p.grantedToV2?.siteUser?.email ?? null;
    const display = u?.displayName ?? p.grantedToV2?.siteUser?.displayName ?? null;
    return { email, display: display ?? email };
}

function isExternalEmail(email: string | null, tenantDomains: string[]): boolean {
    if (!email) return false;
    const at = email.lastIndexOf("@");
    if (at < 0) return false;
    const dom = email.slice(at + 1).toLowerCase();
    return !tenantDomains.some((d) => dom === d || dom.endsWith("." + d));
}

function isSuspiciousDomain(email: string | null): boolean {
    if (!email) return false;
    const dom = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    return SUSPICIOUS_TLDS.some((tld) => dom.endsWith(tld));
}

function scoreShare(opts: {
    isExternal: boolean;
    isAnonymous: boolean;
    isSuspicious: boolean;
    dormantDays: number | null;
    linkType: string | null;
}): { score: number; factors: Array<{ kind: string; points: number; evidence: string }> } {
    const factors: Array<{ kind: string; points: number; evidence: string }> = [];
    let score = 0;
    if (opts.isAnonymous) {
        factors.push({ kind: "anonymous_link", points: 35, evidence: "Anyone with the link" });
        score += 35;
    }
    if (opts.isExternal) {
        factors.push({ kind: "external_recipient", points: 20, evidence: "Shared with external address" });
        score += 20;
    }
    if (opts.isSuspicious) {
        factors.push({ kind: "suspicious_domain", points: 30, evidence: "Recipient on adversary TLD or known-bad domain" });
        score += 30;
    }
    if (opts.linkType === "edit") {
        factors.push({ kind: "edit_access", points: 10, evidence: "Recipient has write access" });
        score += 10;
    }
    if (opts.dormantDays !== null && opts.dormantDays > 90) {
        factors.push({ kind: "dormant", points: 15, evidence: `Item unmodified for ${opts.dormantDays}d` });
        score += 15;
    }
    if (score > 100) score = 100;
    return { score, factors };
}

async function walkDrive(
    token: string,
    driveId: string,
    driveOwner: string,
    driveKind: string,
    tenantPk: string,
    organizationId: string,
    tenantDomains: string[],
): Promise<{ items: number; perms: number; ext: number }> {
    let items = 0, perms = 0, ext = 0;
    let next: string | null = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?$top=200`;
    let pages = 0;
    const queue: string[] = [];
    while (next && pages < 5 && items < MAX_ITEMS_PER_DRIVE) {
        const body = await graphGet<{ value?: DriveItem[]; "@odata.nextLink"?: string }>(token, next);
        if (!body) break;
        for (const it of body.value ?? []) {
            items++;
            if (it.folder) queue.push(it.id);
            if (it.shared) {
                const p = await processItemPermissions(token, driveId, driveOwner, driveKind, it, tenantPk, organizationId, tenantDomains);
                perms += p.permsTotal;
                ext += p.permsExternal;
            }
            if (items >= MAX_ITEMS_PER_DRIVE) break;
        }
        next = body["@odata.nextLink"] ?? null;
        pages++;
    }
    // Walk first 5 sub-folders to catch nested shares too.
    for (const folderId of queue.slice(0, 5)) {
        if (items >= MAX_ITEMS_PER_DRIVE) break;
        const body = await graphGet<{ value?: DriveItem[] }>(
            token,
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?$top=100`,
        );
        for (const it of body?.value ?? []) {
            items++;
            if (it.shared) {
                const p = await processItemPermissions(token, driveId, driveOwner, driveKind, it, tenantPk, organizationId, tenantDomains);
                perms += p.permsTotal;
                ext += p.permsExternal;
            }
            if (items >= MAX_ITEMS_PER_DRIVE) break;
        }
    }
    return { items, perms, ext };
}

async function processItemPermissions(
    token: string,
    driveId: string,
    driveOwner: string,
    driveKind: string,
    item: DriveItem,
    tenantPk: string,
    organizationId: string,
    tenantDomains: string[],
): Promise<{ permsTotal: number; permsExternal: number }> {
    const body = await graphGet<{ value?: Permission[] }>(
        token,
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${item.id}/permissions`,
    );
    if (!body?.value) return { permsTotal: 0, permsExternal: 0 };

    const now = new Date();
    const lastMod = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;
    const dormantDays = lastMod ? Math.floor((now.getTime() - lastMod.getTime()) / (24 * 60 * 60 * 1000)) : null;

    let total = 0, external = 0;
    const rowsToUpsert: Array<Record<string, unknown>> = [];
    for (const p of body.value) {
        // Skip inherited permissions — they're already counted at the parent.
        if (p.inheritedFrom) continue;
        total++;

        const linkScope = p.link?.scope ?? null;
        const linkType = p.link?.type ?? null;
        const isAnonymous = linkScope === "anonymous";

        const { email, display } = permissionRecipient(p);
        const isExternal = isAnonymous || isExternalEmail(email, tenantDomains);
        const isSuspicious = isSuspiciousDomain(email);

        if (isExternal) external++;

        const s = scoreShare({ isExternal, isAnonymous, isSuspicious, dormantDays, linkType });

        rowsToUpsert.push({
            organization_id:        organizationId,
            m365_tenant_id:         tenantPk,
            drive_id:               driveId,
            drive_owner:            driveOwner,
            drive_kind:             driveKind,
            item_id:                item.id,
            item_name:              item.name ?? null,
            item_path:              item.parentReference?.path ?? null,
            item_type:              item.folder ? "folder" : "file",
            item_web_url:           item.webUrl ?? null,
            item_size_bytes:        item.size ?? null,
            item_last_modified_at:  item.lastModifiedDateTime ?? null,
            permission_id:          p.id,
            link_scope:             linkScope,
            link_type:              linkType,
            granted_to_email:       email,
            granted_to_display_name: display,
            granted_at:             p.grantedDateTime ?? null,
            expires_at:             p.expirationDateTime ?? null,
            is_external:            isExternal,
            is_anonymous_link:      isAnonymous,
            is_suspicious_domain:   isSuspicious,
            dormant_days:           dormantDays,
            risk_score:             s.score,
            risk_factors:           s.factors,
            last_seen_at:           new Date().toISOString(),
            removed_at:             null,
        });
    }

    if (rowsToUpsert.length > 0) {
        await supabase
            .from("m365_shared_items")
            .upsert(rowsToUpsert, { onConflict: "m365_tenant_id,drive_id,item_id,permission_id" });
    }
    return { permsTotal: total, permsExternal: external };
}

async function pollTenant(t: TenantRow): Promise<{ ok: boolean; users: number; sites: number; items: number; ext: number; error?: string }> {
    let token: string;
    try { token = await ensureFreshToken(t); }
    catch (e) { return { ok: false, users: 0, sites: 0, items: 0, ext: 0, error: `token: ${String((e as Error).message ?? e).slice(0, 200)}` }; }

    const tenantDomains = await fetchTenantDomains(token);

    // 1. User OneDrives
    const users = await fetchUsers(token, MAX_USERS_PER_RUN);
    let itemsTotal = 0, externalTotal = 0, usersOk = 0;
    for (const u of users) {
        try {
            // /users/{id}/drive returns the user's OneDrive; check it exists first
            const drive = await graphGet<{ id?: string }>(token, `https://graph.microsoft.com/v1.0/users/${u.id}/drive?$select=id`);
            if (!drive?.id) continue;
            const r = await walkDrive(token, drive.id, u.userPrincipalName ?? u.id, "onedrive", t.tenant_pk, t.organization_id, tenantDomains);
            itemsTotal += r.items;
            externalTotal += r.ext;
            usersOk++;
        } catch { continue; }
    }

    // 2. SharePoint sites
    const sites = await fetchTopSites(token, MAX_SITES_PER_RUN);
    let sitesOk = 0;
    for (const s of sites) {
        try {
            const drive = await graphGet<{ id?: string }>(token, `https://graph.microsoft.com/v1.0/sites/${s.id}/drive?$select=id`);
            if (!drive?.id) continue;
            const r = await walkDrive(token, drive.id, s.displayName ?? s.id, "sharepoint", t.tenant_pk, t.organization_id, tenantDomains);
            itemsTotal += r.items;
            externalTotal += r.ext;
            sitesOk++;
        } catch { continue; }
    }

    return { ok: true, users: usersOk, sites: sitesOk, items: itemsTotal, ext: externalTotal };
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

    // Top-level safety net. Sharing poll is heavy (per-drive fan-out across
    // OneDrives + SharePoint sites) and cold-start memory pressure has
    // occasionally produced raw 500s with no JSON body — which the manual
    // scan-all orchestrator reads as "graph_error". Always return 200 with
    // a structured body so the orchestrator can classify per-tenant state
    // correctly, even if something at the top level goes wrong.
    const results: Array<{ tenant: string; ok: boolean; users: number; sites: number; items: number; ext: number; error?: string }> = [];
    try {
        const { data: tenants, error } = await supabase.rpc("shielded_m365_tenants");
        if (error) {
            return json({ ok: false, tenants: 0, results, error: "tenants_query_failed", detail: error.message }, 200, origin);
        }
        for (const t of (tenants ?? []) as TenantRow[]) {
            try {
                const r = await pollTenant(t);
                results.push({ tenant: t.tenant_display_name ?? t.tenant_id, ...r });
            } catch (e) {
                results.push({
                    tenant: t.tenant_display_name ?? t.tenant_id,
                    ok: false, users: 0, sites: 0, items: 0, ext: 0,
                    error: String((e as Error).message ?? e).slice(0, 200),
                });
            }
        }
        return json({ ok: true, tenants: results.length, results }, 200, origin);
    } catch (topLevelErr) {
        // Worst case — still return 200 so scan-all reads a structured body.
        return json({
            ok: false, tenants: results.length, results,
            error: "internal", detail: String((topLevelErr as Error).message ?? topLevelErr).slice(0, 200),
        }, 200, origin);
    }
});
