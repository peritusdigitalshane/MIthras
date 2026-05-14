// POST /functions/v1/agent-heartbeat
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Body: { os_version?, os_build?, defender_version?, agent_version?, status: { realtime_protection_enabled, ... } }
// Response 200: { commands: [], next_check_in: number }   // commands populated in phase 3
// Response 401 on HMAC failure / inactive endpoint
//
// This is the NEW heartbeat endpoint. Legacy agent-api keeps running untouched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const NEXT_CHECK_IN_SECONDS = 60;

type HeartbeatBody = {
    os_version?: string;
    os_build?: string;
    defender_version?: string;
    agent_version?: string;
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) {
        return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);
    }

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, agent_secret, is_active")
        .eq("id", hmacReq.agentId)
        .maybeSingle();

    if (lookupErr) {
        console.error("endpoint lookup failed", lookupErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    let body: HeartbeatBody = {};
    if (hmacReq.rawBody) {
        try {
            body = JSON.parse(hmacReq.rawBody);
        } catch {
            return jsonResponse({ error: "invalid_json" }, 400, origin);
        }
    }

    const updates: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        is_online: true,
        updated_at: new Date().toISOString(),
    };
    if (body.os_version) updates.os_version = body.os_version;
    if (body.os_build) updates.os_build = body.os_build;
    if (body.defender_version) updates.defender_version = body.defender_version;
    if (body.agent_version) updates.agent_version = body.agent_version;

    const { error: updateErr } = await supabase
        .from("endpoints")
        .update(updates)
        .eq("id", endpoint.id);

    if (updateErr) {
        console.error("heartbeat update failed", updateErr);
        return jsonResponse({ error: "update_failed" }, 500, origin);
    }

    // ── Linux-specific dispatch ─────────────────────────────────────────
    const linuxFields: Record<string, unknown> = {};
    for (const k of ["distro", "distro_version", "kernel_version", "uptime_seconds",
                     "last_boot_at", "unattended_upgrades", "lsm_status", "ssh_config_summary"]) {
        if ((body as Record<string, unknown>)[k] !== undefined) linuxFields[k] = (body as Record<string, unknown>)[k];
    }
    if (Object.keys(linuxFields).length > 0) {
        const { error: linuxUpdateErr } = await supabase
            .from("endpoints")
            .update(linuxFields)
            .eq("id", endpoint.id);
        if (linuxUpdateErr) console.error("linux endpoint update", linuxUpdateErr);
    }

    // firewall_snapshot — insert one row per heartbeat that has it (collector cadence 15m).
    if ((body as Record<string, unknown>).firewall_snapshot && typeof (body as Record<string, unknown>).firewall_snapshot === "object") {
        const fs = (body as Record<string, unknown>).firewall_snapshot as Record<string, unknown>;
        const { error: fwErr } = await supabase.from("linux_firewall_snapshots").insert({
            endpoint_id: endpoint.id,
            frontend: fs.frontend, default_in: fs.default_in, default_out: fs.default_out,
            rule_count: fs.rule_count ?? 0, risky_count: fs.risky_count ?? 0,
            raw_text: fs.raw_text,
        });
        if (fwErr) console.error("linux_firewall_snapshots insert", fwErr);
    }

    // listening_ports — replace the latest set for this endpoint.
    if (Array.isArray((body as Record<string, unknown>).listening_ports)) {
        await supabase.from("linux_listening_ports").delete().eq("endpoint_id", endpoint.id);
        const rows = ((body as Record<string, unknown>).listening_ports as Record<string, unknown>[]).map(p => ({
            endpoint_id: endpoint.id,
            proto: p.proto, bind_addr: p.bind_addr, port: p.port,
            pid: p.pid, comm: p.comm,
        }));
        if (rows.length > 0) {
            const { error: portsErr } = await supabase.from("linux_listening_ports").insert(rows);
            if (portsErr) console.error("linux_listening_ports insert", portsErr);
        }
    }

    // pending_updates — write each as a vulnerability_findings row (open if not already).
    if (Array.isArray((body as Record<string, unknown>).pending_updates)) {
        for (const u of (body as Record<string, unknown>).pending_updates as Record<string, unknown>[]) {
            const cveId = `apt-security:${u.package}`;
            await supabase.from("vulnerability_findings").upsert({
                endpoint_id: endpoint.id,
                cve_id: cveId,
                affected_software: u.package,
                installed_version: u.current,
                fixed_version: u.candidate,
                cvss_score: u.severity === "critical" ? 9 : u.severity === "high" ? 7 : u.severity === "medium" ? 5 : 3,
                status: "open",
            }, { onConflict: "endpoint_id,cve_id,affected_software" });
        }
    }

    // auth_events — append to endpoint_event_logs.
    // endpoint_event_logs.event_id is a NOT NULL integer shaped for Windows Event Log IDs.
    // For Linux events we synthesize the Windows-equivalent ID so the existing dashboards
    // (which key off the standard 4624/4625/4634/4688 set) keep working across platforms.
    if (Array.isArray((body as Record<string, unknown>).auth_events)) {
        const synthesizeEventId = (msg: string): number => {
            const m = (msg ?? "").toLowerCase();
            if (m.includes("failed password") || m.includes("authentication failure") || m.includes("invalid user")) return 4625;
            if (m.includes("accepted ") || m.includes("session opened")) return 4624;
            if (m.includes("session closed") || m.includes("logged out")) return 4634;
            if (m.includes("command=") || m.includes("sudo:")) return 4688;
            return 4625;
        };
        const rows = ((body as Record<string, unknown>).auth_events as Record<string, unknown>[]).map(e => ({
            endpoint_id: endpoint.id,
            event_id: synthesizeEventId(String(e.message ?? "")),
            event_time: e.ts,
            log_source: e.source,
            level: e.level,
            message: e.message,
        }));
        if (rows.length > 0) {
            // Linux agent re-streams the journald tail every heartbeat, so duplicates within
            // the (endpoint_id, event_id, event_time) dedup index are expected. ignoreDuplicates
            // makes the batch land partial-success instead of rolling back atomically.
            const { error: evErr } = await supabase
                .from("endpoint_event_logs")
                .upsert(rows, { onConflict: "endpoint_id,event_id,event_time", ignoreDuplicates: true });
            if (evErr) console.error("endpoint_event_logs upsert", evErr);
        }
    }

    // App-control state: one merged payload across all rule sets assigned to this endpoint.
    let appControl: unknown = null;
    {
        const { data, error: acErr } = await supabase.rpc('app_control_state_for_endpoint', { p_endpoint_id: endpoint.id });
        if (acErr) console.error('app_control_state_for_endpoint', acErr);
        else appControl = data ?? { mode: 'off' };
    }

    // Phase 3 will populate commands here from agent_commands table.
    return jsonResponse({
        commands: [],
        next_check_in: NEXT_CHECK_IN_SECONDS,
        app_control: appControl,
    }, 200, origin);
});
