// =============================================================================
// Mithras public REST API v1
//
//   Base URL:  https://api.mithras.com.au/functions/v1/api-v1
//   Auth:      Authorization: Bearer mit_live_<token>
//
// Routes:
//   GET    /me                          — calling identity + org context
//   GET    /customers                   — list customers (reseller/distributor)
//   POST   /customers                   — create customer (reseller/distributor)
//   GET    /endpoints                   — list endpoints in this org
//   GET    /endpoints/:id               — endpoint detail
//   GET    /incidents                   — list incidents
//   GET    /incidents/:id               — incident detail
//   GET    /threats                     — list threats
//   GET    /reports                     — monthly customer reports
//   POST   /agent/enrollment-token      — issue a single-use install token
//   GET    /openapi.json                — OpenAPI spec for this surface
//
// Pagination on collection endpoints: ?limit=NN&offset=NN (defaults 50/0,
// max 200). Responses include `total` and `next_offset` where applicable.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveApiKey, requireScope, requireOrgType, type ApiAuthOk } from "../_shared/api-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            "content-type": "application/json",
            "x-mithras-api-version": "1.0",
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization, content-type",
            "access-control-allow-methods": "GET, POST, OPTIONS",
        },
    });
}

function clampInt(s: string | null, def: number, max: number): number {
    const n = parseInt(s ?? "", 10);
    if (Number.isNaN(n) || n < 0) return def;
    return Math.min(n, max);
}

function isUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Resolve the full set of organisation IDs the caller is permitted to see.
// Single source of truth for tenant scoping across every list and detail
// handler. Returns null when the org type is unrecognised — callers must
// fail closed in that case.
async function visibleOrgIds(auth: ApiAuthOk): Promise<string[] | null> {
    if (auth.organizationType === "customer" || auth.organizationType === "home_user") {
        return [auth.organizationId];
    }
    if (auth.organizationType === "reseller" || auth.organizationType === "partner") {
        const { data: kids } = await supabase
            .from("organizations").select("id").eq("parent_partner_id", auth.organizationId);
        const ids = (kids ?? []).map((o) => o.id as string);
        // Include the reseller's own org so resources the reseller owns directly
        // (endpoints in the reseller's office, internal incidents, enrolment
        // tokens for the reseller's own devices) remain visible.
        return [auth.organizationId, ...ids];
    }
    if (auth.organizationType === "distributor") {
        const { data: resellers } = await supabase
            .from("organizations").select("id").eq("parent_partner_id", auth.organizationId);
        const resellerIds = (resellers ?? []).map((r) => r.id as string);
        if (resellerIds.length === 0) return [auth.organizationId];
        const { data: customers } = await supabase
            .from("organizations").select("id").in("parent_partner_id", resellerIds);
        const customerIds = (customers ?? []).map((c) => c.id as string);
        // Distributor sees: self, its resellers, and the customers under those resellers.
        return [auth.organizationId, ...resellerIds, ...customerIds];
    }
    return null;
}

function forbidden(): Response {
    return json({ error: "forbidden", message: "Organisation type is not permitted to call this endpoint." }, 403);
}

// =============================================================================
// Route handlers
// =============================================================================

async function handleMe(auth: ApiAuthOk): Promise<Response> {
    const { data: org } = await supabase
        .from("organizations")
        .select("id, name, slug, organization_type, subscription_plan, is_active")
        .eq("id", auth.organizationId)
        .single();
    return json({
        api_key_id: auth.apiKeyId,
        scopes:     auth.scopes,
        organization: org ?? { id: auth.organizationId, organization_type: auth.organizationType },
    });
}

async function handleListCustomers(auth: ApiAuthOk, url: URL): Promise<Response> {
    const limit  = clampInt(url.searchParams.get("limit"),  50, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 100_000);

    let q = supabase
        .from("organizations")
        .select("id, name, slug, organization_type, is_active, created_at, credit_balance", { count: "exact" })
        .eq("organization_type", "customer")
        .range(offset, offset + limit - 1)
        .order("created_at", { ascending: false });

    if (auth.organizationType === "reseller" || auth.organizationType === "partner") {
        q = q.eq("parent_partner_id", auth.organizationId);
    } else if (auth.organizationType === "distributor") {
        // Customer's parent is a reseller; reseller's parent is the distributor.
        const { data: resellers } = await supabase
            .from("organizations")
            .select("id")
            .eq("parent_partner_id", auth.organizationId);
        const ids = (resellers ?? []).map((r) => r.id);
        q = q.in("parent_partner_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    } else {
        return json({ error: "wrong_org_type", message: "Only reseller and distributor org types can list customers." }, 403);
    }

    const { data, error, count } = await q;
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    return json({
        data:        data ?? [],
        total:       count ?? 0,
        limit, offset,
        next_offset: (count ?? 0) > offset + limit ? offset + limit : null,
    });
}

async function handleCreateCustomer(auth: ApiAuthOk, req: Request): Promise<Response> {
    const orgGate = requireOrgType(auth, ["reseller", "partner", "distributor"]);
    if (orgGate) return orgGate;
    const scopeGate = requireScope(auth, "customers:write");
    if (scopeGate) return scopeGate;

    let body: any = {};
    try { body = await req.json(); } catch {
        return json({ error: "invalid_json" }, 400);
    }

    const name = String(body.name ?? "").trim();
    if (name.length < 2) return json({ error: "name_required", message: "Field 'name' is required (min 2 chars)." }, 400);
    const parentOrgId = body.reseller_id
        ? String(body.reseller_id)
        : auth.organizationId;
    if (!isUuid(parentOrgId)) return json({ error: "invalid_reseller_id" }, 400);

    const wholesale = body.wholesale_price_cents != null ? parseInt(String(body.wholesale_price_cents), 10) : null;
    if (wholesale != null && (Number.isNaN(wholesale) || wholesale < 0 || wholesale > 100_000)) {
        return json({ error: "invalid_wholesale_price" }, 400);
    }

    const { data, error } = await supabase.rpc("api_create_customer", {
        p_parent_org_id: parentOrgId,
        p_name:          name,
        p_wholesale_price_cents: wholesale,
        p_acting_org_id: auth.organizationId,
    });
    if (error) {
        if (error.message?.includes("forbidden")) return json({ error: "forbidden", message: "Acting org does not own the specified reseller." }, 403);
        if (error.message?.includes("name_too_short")) return json({ error: "name_too_short" }, 400);
        return json({ error: "create_failed", message: error.message }, 500);
    }
    return json({ data }, 201);
}

async function handleListEndpoints(auth: ApiAuthOk, url: URL): Promise<Response> {
    const scopeGate = requireScope(auth, "endpoints:read");
    if (scopeGate) return scopeGate;

    const limit  = clampInt(url.searchParams.get("limit"),  50, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 100_000);
    const orgFilter = url.searchParams.get("organization_id");

    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();

    let scope = visible;
    if (orgFilter && isUuid(orgFilter)) {
        if (!visible.includes(orgFilter)) return json({ data: [], total: 0, limit, offset, next_offset: null });
        scope = [orgFilter];
    }

    const q = supabase
        .from("endpoints")
        .select("id, hostname, runtime, agent_version, is_active, enrolled_at, organization_id, last_seen_at", { count: "exact" })
        .in("organization_id", scope)
        .range(offset, offset + limit - 1)
        .order("enrolled_at", { ascending: false });

    const { data, error, count } = await q;
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    return json({
        data:        data ?? [],
        total:       count ?? 0,
        limit, offset,
        next_offset: (count ?? 0) > offset + limit ? offset + limit : null,
    });
}

async function handleGetEndpoint(auth: ApiAuthOk, id: string): Promise<Response> {
    const scopeGate = requireScope(auth, "endpoints:read");
    if (scopeGate) return scopeGate;
    if (!isUuid(id)) return json({ error: "invalid_id" }, 400);

    const { data, error } = await supabase
        .from("endpoints")
        .select("id, hostname, runtime, agent_version, is_active, enrolled_at, organization_id, last_seen_at")
        .eq("id", id)
        .maybeSingle();
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);

    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();
    if (!visible.includes(data.organization_id)) return json({ error: "not_found" }, 404);
    return json({ data });
}

async function handleListIncidents(auth: ApiAuthOk, url: URL): Promise<Response> {
    const scopeGate = requireScope(auth, "incidents:read");
    if (scopeGate) return scopeGate;
    const limit  = clampInt(url.searchParams.get("limit"),  50, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 100_000);
    const status = url.searchParams.get("status");

    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();

    let q = supabase
        .from("incidents")
        .select("id, organization_id, title, severity, status, opened_at, sla_due_at, resolved_at, resolution_notes", { count: "exact" })
        .in("organization_id", visible)
        .range(offset, offset + limit - 1)
        .order("opened_at", { ascending: false });
    if (status) q = q.eq("status", status);

    const { data, error, count } = await q;
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    return json({
        data:        data ?? [],
        total:       count ?? 0,
        limit, offset,
        next_offset: (count ?? 0) > offset + limit ? offset + limit : null,
    });
}

async function handleGetIncident(auth: ApiAuthOk, id: string): Promise<Response> {
    const scopeGate = requireScope(auth, "incidents:read");
    if (scopeGate) return scopeGate;
    if (!isUuid(id)) return json({ error: "invalid_id" }, 400);

    const { data, error } = await supabase
        .from("incidents")
        .select(`
            id, organization_id, title, description, severity, status, opened_at,
            sla_due_at, resolved_at, resolution_notes, playbook_step, playbook_state,
            commander_summary, commander_kind, alert_id, triage_decision_id
        `)
        .eq("id", id)
        .maybeSingle();
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);

    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();
    if (!visible.includes(data.organization_id)) return json({ error: "not_found" }, 404);
    return json({ data });
}

async function handleListThreats(auth: ApiAuthOk, url: URL): Promise<Response> {
    const scopeGate = requireScope(auth, "threats:read");
    if (scopeGate) return scopeGate;
    const limit  = clampInt(url.searchParams.get("limit"),  50, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 100_000);

    // endpoint_threats has no organization_id column. Scope through endpoints
    // first using the shared visibility helper, then filter threats by the
    // resulting endpoint ids.
    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();
    const { data: endpointRows } = await supabase
        .from("endpoints").select("id").in("organization_id", visible);
    const endpointIds = (endpointRows ?? []).map((e) => e.id as string);

    const q = supabase
        .from("endpoint_threats")
        .select("id, endpoint_id, threat_name, severity, category, status, initial_detection_time, last_threat_status_change_time", { count: "exact" })
        .in("endpoint_id", endpointIds.length ? endpointIds : ["00000000-0000-0000-0000-000000000000"])
        .range(offset, offset + limit - 1)
        .order("initial_detection_time", { ascending: false });
    const { data, error, count } = await q;
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    return json({
        data:        data ?? [],
        total:       count ?? 0,
        limit, offset,
        next_offset: (count ?? 0) > offset + limit ? offset + limit : null,
    });
}

async function handleListReports(auth: ApiAuthOk, url: URL): Promise<Response> {
    const scopeGate = requireScope(auth, "reports:read");
    if (scopeGate) return scopeGate;
    const limit  = clampInt(url.searchParams.get("limit"),  12, 60);
    const offset = clampInt(url.searchParams.get("offset"), 0, 1000);

    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();

    const q = supabase
        .from("customer_reports")
        .select("id, organization_id, period_start, period_end, status, sent_at, summary", { count: "exact" })
        .in("organization_id", visible)
        .range(offset, offset + limit - 1)
        .order("period_start", { ascending: false });

    const { data, error, count } = await q;
    if (error) return json({ error: "query_failed", message: error.message }, 500);
    return json({
        data:        data ?? [],
        total:       count ?? 0,
        limit, offset,
        next_offset: (count ?? 0) > offset + limit ? offset + limit : null,
    });
}

async function handleEnrollmentToken(auth: ApiAuthOk, req: Request): Promise<Response> {
    const scopeGate = requireScope(auth, "agent:enroll");
    if (scopeGate) return scopeGate;
    let body: any = {};
    try { body = await req.json(); } catch {}

    const targetOrgId = String(body.organization_id ?? auth.organizationId);
    if (!isUuid(targetOrgId)) return json({ error: "invalid_organization_id" }, 400);

    // The caller may issue tokens against any organisation it owns through the
    // tenancy hierarchy. visibleOrgIds() resolves the full owned set including
    // the distributor → reseller → customer two-hop.
    const visible = await visibleOrgIds(auth);
    if (visible === null) return forbidden();
    if (!visible.includes(targetOrgId)) return json({ error: "forbidden" }, 403);

    const ttlMinutes = clampInt(String(body.ttl_minutes ?? "60"), 60, 60 * 24 * 7);
    const platform = String(body.platform ?? "windows").toLowerCase();
    if (!["windows", "linux"].includes(platform)) return json({ error: "invalid_platform" }, 400);
    const runtimeHint = platform === "windows" ? "powershell" : "linux";

    // enrollment_tokens.created_by is NOT NULL with an FK to auth.users — use
    // the api_keys.created_by as the synthetic creator so the row is
    // attributable to the operator who issued the API key.
    const { data: keyRow } = await supabase
        .from("api_keys").select("created_by").eq("id", auth.apiKeyId).maybeSingle();
    if (!keyRow?.created_by) return json({ error: "api_key_owner_missing" }, 500);

    // The raw token is returned to the caller exactly once. The server
    // persists only its SHA-256 hash; a database snapshot leak cannot be
    // used to enrol a rogue endpoint with an outstanding token.
    const token = "ent_" + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(token);
    const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    const { error } = await supabase.rpc("api_issue_enrollment_token", {
        p_organization_id: targetOrgId,
        p_created_by:      keyRow.created_by,
        p_token_hash:      tokenHash,
        p_runtime_hint:    runtimeHint,
        p_channel:         "stable",
        p_expires_at:      expires,
    });
    if (error) return json({ error: "issue_failed", message: error.message }, 500);

    return json({
        data: {
            token,
            expires_at: expires,
            organization_id: targetOrgId,
            platform,
            install_command: platform === "windows"
                ? `iex (iwr "https://api.mithras.com.au/functions/v1/agent-script?token=${token}").Content`
                : `# Linux installer not yet available`,
        },
    }, 201);
}

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// OpenAPI spec
// =============================================================================

import { buildOpenApiSpec } from "./openapi.ts";

// =============================================================================
// Routing
// =============================================================================

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "authorization, content-type",
                "access-control-allow-methods": "GET, POST, OPTIONS",
            },
        });
    }

    const url = new URL(req.url);
    // Strip the function-name prefix from the path so internal routing is clean.
    const rawPath = url.pathname.replace(/^\/functions\/v1\/api-v1/, "").replace(/^\/api-v1/, "") || "/";
    const segments = rawPath.split("/").filter(Boolean);

    // Public — no auth required
    if (segments[0] === "openapi.json" || segments.join("/") === "openapi.json") {
        return json(buildOpenApiSpec());
    }

    const authResult = await resolveApiKey(req, supabase);
    if (!authResult.ok) {
        return json({ error: authResult.error }, authResult.status);
    }
    const auth = authResult;

    // Routes
    try {
        if (segments[0] === "me" && req.method === "GET") {
            return await handleMe(auth);
        }
        if (segments[0] === "customers") {
            if (req.method === "GET" && !segments[1])  return await handleListCustomers(auth, url);
            if (req.method === "POST" && !segments[1]) return await handleCreateCustomer(auth, req);
        }
        if (segments[0] === "endpoints") {
            if (req.method === "GET" && !segments[1]) return await handleListEndpoints(auth, url);
            if (req.method === "GET" && segments[1])  return await handleGetEndpoint(auth, segments[1]);
        }
        if (segments[0] === "incidents") {
            if (req.method === "GET" && !segments[1]) return await handleListIncidents(auth, url);
            if (req.method === "GET" && segments[1])  return await handleGetIncident(auth, segments[1]);
        }
        if (segments[0] === "threats" && req.method === "GET") return await handleListThreats(auth, url);
        if (segments[0] === "reports" && req.method === "GET") return await handleListReports(auth, url);
        if (segments[0] === "agent" && segments[1] === "enrollment-token" && req.method === "POST") {
            return await handleEnrollmentToken(auth, req);
        }
        return json({ error: "not_found", path: rawPath, method: req.method }, 404);
    } catch (e) {
        return json({ error: "internal_error", message: e instanceof Error ? e.message : String(e) }, 500);
    }
});
