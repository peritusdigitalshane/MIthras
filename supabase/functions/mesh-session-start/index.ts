// POST /functions/v1/mesh-session-start
//
// SOC operator clicked "Remote Desktop" on an endpoint. This function:
//   1. Authenticates the operator's JWT.
//   2. Verifies they're a super-admin OR admin/owner of the endpoint's org.
//   3. Looks up the endpoint's mesh_node_id (populated by the agent after
//      MeshAgent enrols; null if MeshAgent hasn't checked in yet).
//   4. Records a row in remote_desktop_sessions for audit.
//   5. Returns the MeshCentral URL the frontend should open.
//
// Transport is MeshCentral - the MeshAgent holds an outbound WSS to
// remote.mithras.com.au and operators connect through MeshCentral's
// own web UI. No inbound firewall changes needed on the customer side.
//
// First-time login is manual (operator logs into MeshCentral once per
// browser session). Phase B: mint single-use login cookies via meshctrl
// so it's truly SSO from the SOC console.
//
// Request body:
//   { endpoint_id: uuid, reason?: string, view_mode?: 'desktop'|'terminal'|'files' }
// Response:
//   { session_id, url, mesh_node_id, requires_login: true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MESH_BASE_URL        = Deno.env.get("MESH_BASE_URL") ?? "https://remote.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const VIEW_MODE_TO_INT: Record<string, number> = {
    // MeshCentral tab indices for ?viewmode=
    //   10 = General (info / battery / network status — NOT remote desktop!)
    //   11 = Desktop (this is what we almost always want)
    //   12 = Terminal
    //   13 = Files
    //   14 = Intel AMT
    //   15 = Console
    general:  10,
    desktop:  11,
    terminal: 12,
    files:    13,
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const endpointId = String(body.endpoint_id ?? "");
    const reason     = body.reason ? String(body.reason).slice(0, 500) : null;
    const viewModeStr = String(body.view_mode ?? "desktop");
    const viewMode    = VIEW_MODE_TO_INT[viewModeStr] ?? VIEW_MODE_TO_INT.desktop;
    if (!endpointId) return jsonResponse({ error: "endpoint_id_required" }, 400, origin);

    // Load endpoint + org for authorization. Service role bypasses RLS so we
    // can read the row even if the JWT belongs to a non-member -- the auth
    // check below catches that case explicitly.
    const { data: endpoint, error: epErr } = await supabase
        .from("endpoints")
        .select("id, organization_id, hostname, mesh_node_id, mesh_agent_state, is_active")
        .eq("id", endpointId)
        .maybeSingle();
    if (epErr || !endpoint) return jsonResponse({ error: "endpoint_not_found" }, 404, origin);
    if (endpoint.is_active === false) return jsonResponse({ error: "endpoint_inactive" }, 409, origin);
    // Remote access is opt-in: the operator must install MeshAgent via the
    // Remote Access card on the endpoint detail page before a session can be
    // opened. Without this gate the iframe would land on a MeshCentral home
    // page that doesn't know about the device.
    if (endpoint.mesh_agent_state !== "installed") {
        return jsonResponse({
            error: "remote_access_not_installed",
            mesh_agent_state: endpoint.mesh_agent_state,
            hint: "Install Remote Access on this endpoint from the SOC console first.",
        }, 409, origin);
    }

    // Authorize: super_admin OR admin/owner of the endpoint's org. Plain
    // members cannot launch remote desktop -- that's a privileged operation
    // logged to remote_desktop_sessions.
    const { data: isSuper } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();

    let allowed = !!isSuper;
    if (!allowed) {
        const { data: membership } = await supabase
            .from("organization_memberships")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", endpoint.organization_id)
            .maybeSingle();
        if (membership && (membership.role === "admin" || membership.role === "owner")) {
            allowed = true;
        }
    }
    if (!allowed) return jsonResponse({ error: "forbidden" }, 403, origin);

    // Build the MeshCentral URL.
    //   gotonode=<short>  deep-link to the device. MUST be the SHORT id
    //                     (just the part after "node//"); passing the full
    //                     "node//<x>" form silently fails the lookup.
    //   viewmode=10       desktop tab (11 = terminal, 13 = files)
    //   hide=31           1 left col + 2 top bar + 4 title + 8 footer +
    //                     16 notifications. Matches what MeshCentral itself
    //                     uses for its "open device in window" popout, plus
    //                     we hide the left device list too since the iframe
    //                     only shows one device.
    // If the agent hasn't reported its mesh_node_id yet we land on the home
    // page; user picks the device by hostname.
    // MeshCentral's parseUriArgs runs each query value through isSafeString2,
    // which REJECTS any value containing '%'. So we MUST NOT URL-encode the
    // node id - encodeURIComponent turns '$' into '%24', which MC then drops
    // silently, leaving gotonode undefined and the deep-link a no-op.
    // The node id alphabet (a-zA-Z0-9$@) is URL-safe as-is.
    const meshShort = endpoint.mesh_node_id?.replace(/^node\/\//, "") ?? null;
    let url = MESH_BASE_URL.replace(/\/$/, "");
    if (meshShort) {
        url += `/?gotonode=${meshShort}&viewmode=${viewMode}&hide=31`;
    } else {
        url += "/?hide=31";
    }

    // Insert audit row.
    const { data: session, error: insErr } = await supabase
        .from("remote_desktop_sessions")
        .insert({
            organization_id: endpoint.organization_id,
            endpoint_id:     endpoint.id,
            initiated_by:    user.id,
            reason,
            mesh_node_id:    endpoint.mesh_node_id ?? null,
            session_url:     url,
            transport:       "meshcentral",
            status:          "initiated",
        })
        .select("id")
        .single();

    if (insErr || !session) {
        console.error("[mesh-session-start] audit insert failed", insErr);
        return jsonResponse({ error: "audit_failed", detail: insErr?.message }, 500, origin);
    }

    // Activity log (best-effort).
    try {
        // activity_logs schema uses resource_type / resource_id / details
        // (NOT entity_type / entity_id / metadata). Wrong column names
        // previously caused every remote-desktop session to silently fail
        // its audit log insert - PostgREST returns { error } rather than
        // throwing, so the try/catch never caught it.
        await supabase.from("activity_logs").insert({
            organization_id: endpoint.organization_id,
            user_id:         user.id,
            action:          "remote_desktop.initiated",
            resource_type:   "endpoint",
            resource_id:     endpoint.id,
            details: {
                session_id:   session.id,
                hostname:     endpoint.hostname,
                mesh_node_id: endpoint.mesh_node_id,
                transport:    "meshcentral",
            },
        });
    } catch (e) {
        console.error("[mesh-session-start] activity_logs insert failed (non-fatal)", e);
    }

    return jsonResponse({
        session_id:     session.id,
        url,
        mesh_node_id:   endpoint.mesh_node_id,
        requires_login: true,
        hostname:       endpoint.hostname,
    }, 200, origin);
});
