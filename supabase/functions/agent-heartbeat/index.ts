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
    hostname?: string;
    os_version?: string;
    os_build?: string;
    defender_version?: string;
    agent_version?: string;

    // --- v0.4.0+ enriched telemetry ---
    defender_status?: Record<string, unknown>;
    threats?: Array<Record<string, unknown>>;
    event_logs?: Array<Record<string, unknown>>;
    software_inventory?: Array<Record<string, unknown>>;
    // When true, server treats software_inventory as the complete current set
    // and replaces the existing rows for this endpoint. False/undefined = append/upsert.
    software_inventory_complete?: boolean;

    // --- v0.4.5+ EDR-tier telemetry ---
    process_events?: Array<Record<string, unknown>>;
    persistence_snapshot?: Record<string, unknown>;
    wdac_blocks?: Array<Record<string, unknown>>;
    command_results?: Array<Record<string, unknown>>;

    // --- v0.6.5+ tamper-protection telemetry ---
    // SCM events 7034/7036/7040/7045 for MithrasAgent. Each goes straight to
    // the alerts table with alert_type='tamper_attempt'.
    tamper_events?: Array<Record<string, unknown>>;

    // --- v0.6.6+ ransomware canary telemetry ---
    // Each entry: { path, event_type: 'modified'|'deleted', observed_sha256,
    // expected_sha256, observed_size, expected_size, event_time }.
    // Server inserts as alert_type='ransomware_canary_tripped' severity=critical.
    canary_events?: Array<Record<string, unknown>>;

    // --- v0.6.6+ Defender state snapshot ---
    // Get-DefenderStatePayload output -- active threats + last-24h detections
    // + behavior monitor / ASR rule status + Mithras-paths-excluded flag.
    // Server stores latest in endpoints.defender_state JSONB for SOC triage.
    defender_state?: Record<string, unknown>;

    // Preflight heartbeat: one-shot POST the agent fires on startup before
    // its main loop runs, only to receive legacy_agent_token so first-pass
    // subsystems have a bearer. The preflight handler ignores response
    // .commands — so server must NOT dispatch queued commands on these.
    preflight?: boolean;
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
        .select("id, agent_secret, agent_token, is_active, organization_id, agent_version")
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
    // v0.7.9: agent now ships current ComputerName so Windows renames are
    // reflected. Capped at 255 chars (the table's text column) to defend
    // against a misbehaving agent shipping a megabyte string.
    if (typeof body.hostname === "string" && body.hostname.length > 0) {
        updates.hostname = body.hostname.slice(0, 255);
    }

    // Auto-update fix #2: detect agent version transition and log it. Mirrors
    // the bearer-token /agent-api path so modern + legacy agents both produce
    // audit rows without any agent-side code change.
    if (body.agent_version && body.agent_version !== endpoint.agent_version) {
        try {
            await supabase.from("agent_update_log").insert({
                endpoint_id:     endpoint.id,
                organization_id: endpoint.organization_id,
                from_version:    endpoint.agent_version,
                to_version:      String(body.agent_version),
                trigger:         "heartbeat_detected",
                status:          "completed",
                completed_at:    new Date().toISOString(),
            });
        } catch (e) {
            console.error("agent_update_log insert failed", e);
        }
    }

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
    // uptime_seconds is bigint in the DB; the Linux agent reads /proc/uptime
    // which returns a float (e.g. 872664.22). Coerce so the UPDATE doesn't 22P02.
    if (typeof linuxFields.uptime_seconds === "number") {
        linuxFields.uptime_seconds = Math.floor(linuxFields.uptime_seconds);
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
    // Linux agent ships {protocol, port (string), local}. Map to schema:
    // proto (NOT NULL text), port (integer), bind_addr (inet, nullable),
    // pid (integer, nullable), comm (text, nullable).
    if (Array.isArray((body as Record<string, unknown>).listening_ports)) {
        await supabase.from("linux_listening_ports").delete().eq("endpoint_id", endpoint.id);
        const rows = ((body as Record<string, unknown>).listening_ports as Record<string, unknown>[]).map(p => {
            const proto = (p.proto ?? p.protocol ?? "unknown") as string;
            const portNum = typeof p.port === "number" ? p.port : parseInt(String(p.port ?? ""), 10);
            // bind_addr is inet; pull the host portion off "0.0.0.0:53"-style strings.
            // Leave null if we can't parse — inet won't accept "*" or empty strings.
            // bind_addr is inet NOT NULL. Default to 0.0.0.0 when we get a
            // wildcard listener (`*:443`, `::*`) — semantically "all interfaces".
            let bindAddr = "0.0.0.0";
            const rawBind = (p.bind_addr ?? p.local ?? null) as string | null;
            if (typeof rawBind === "string" && rawBind.length > 0) {
                const lastColon = rawBind.lastIndexOf(":");
                const host = lastColon > 0 ? rawBind.slice(0, lastColon) : rawBind;
                // Strip IPv6 brackets and the Linux %iface scope suffix
                // ("127.0.0.53%lo" → "127.0.0.53") which the inet type rejects.
                const cleaned = host.replace(/^\[|\]$/g, "").split("%")[0];
                if (cleaned && cleaned !== "*" && cleaned !== "::*") bindAddr = cleaned;
                else if (cleaned === "::*") bindAddr = "::";
            }
            return {
                endpoint_id: endpoint.id,
                proto,
                bind_addr: bindAddr,
                port: Number.isFinite(portNum) ? portNum : null,
                pid: (p.pid ?? null) as number | null,
                comm: (p.comm ?? null) as string | null,
            };
        }).filter(r => r.port !== null);
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

    // ── Windows-side enriched telemetry (Phase 2, v0.4.0+) ─────────────
    // The agent posts these sections opportunistically; each is independent
    // and best-effort. Failures don't abort the heartbeat.

    // 1. Defender posture snapshot.
    if (body.defender_status && typeof body.defender_status === "object") {
        const s = body.defender_status as Record<string, unknown>;
        const toBool = (v: unknown) => (typeof v === "boolean" ? v : v === null || v === undefined ? null : Boolean(v));
        // Postgres "integer" is signed 32-bit. Defender returns UInt32-max
        // (4294967295) as a "no data" sentinel for AntivirusSignatureAge,
        // FullScanAge, QuickScanAge etc. when the machine has never scanned /
        // never updated. Clamp anything outside int32 range to null so the
        // INSERT doesn't fail with PG error 22003.
        const INT32_MAX = 2147483647, INT32_MIN = -2147483648;
        const toInt  = (v: unknown) => {
            if (typeof v !== "number" || !Number.isFinite(v)) return null;
            const n = Math.trunc(v);
            if (n > INT32_MAX || n < INT32_MIN) return null;
            return n;
        };
        const toTs   = (v: unknown) => { try { return v ? new Date(v as string).toISOString() : null; } catch { return null; } };
        // v0.4.6: UAC + Windows Update posture come as flat top-level fields
        // on the payload alongside defender_status. Merge them into the same
        // endpoint_status insert.
        const b = body as Record<string, unknown>;
        const { error: dsErr } = await supabase.from("endpoint_status").insert({
            endpoint_id: endpoint.id,
            realtime_protection_enabled:  toBool(s.realtime_protection_enabled),
            antivirus_enabled:            toBool(s.antivirus_enabled),
            antispyware_enabled:          toBool(s.antispyware_enabled),
            behavior_monitor_enabled:     toBool(s.behavior_monitor_enabled),
            ioav_protection_enabled:      toBool(s.ioav_protection_enabled),
            on_access_protection_enabled: toBool(s.on_access_protection_enabled),
            nis_enabled:                  toBool(s.nis_enabled),
            antivirus_signature_age:      toInt(s.antivirus_signature_age),
            antispyware_signature_age:    toInt(s.antispyware_signature_age),
            antivirus_signature_version:  s.antivirus_signature_version ?? null,
            nis_signature_version:        s.nis_signature_version ?? null,
            am_running_mode:              s.am_running_mode ?? null,
            tamper_protection_source:     s.tamper_protection_source ?? null,
            full_scan_age:                toInt(s.full_scan_age),
            quick_scan_age:               toInt(s.quick_scan_age),
            full_scan_end_time:           toTs(s.full_scan_end_time),
            quick_scan_end_time:          toTs(s.quick_scan_end_time),
            computer_state:               toInt(s.computer_state),
            raw_status:                   s,
            // v0.4.6 UAC posture
            uac_enabled:                    toBool(b.uac_enabled),
            uac_consent_prompt_admin:       toInt(b.uac_consent_prompt_admin),
            uac_consent_prompt_user:        toInt(b.uac_consent_prompt_user),
            uac_prompt_on_secure_desktop:   toBool(b.uac_prompt_on_secure_desktop),
            uac_filter_administrator_token: toBool(b.uac_filter_administrator_token),
            uac_validate_admin_signatures:  toBool(b.uac_validate_admin_signatures),
            uac_detect_installations:       toBool(b.uac_detect_installations),
            // v0.4.6 Windows Update posture
            wu_auto_update_mode:            toInt(b.wu_auto_update_mode),
            wu_active_hours_start:          toInt(b.wu_active_hours_start),
            wu_active_hours_end:            toInt(b.wu_active_hours_end),
            wu_feature_update_deferral:     toInt(b.wu_feature_update_deferral),
            wu_quality_update_deferral:     toInt(b.wu_quality_update_deferral),
            wu_pause_feature_updates:       toBool(b.wu_pause_feature_updates),
            wu_pause_quality_updates:       toBool(b.wu_pause_quality_updates),
            wu_restart_pending:             toBool(b.wu_restart_pending),
        });
        if (dsErr) console.error("endpoint_status insert", dsErr);
    }

    // 2. Defender threats — upsert by (endpoint_id, threat_id).
    // PoC rec #10: the previous filter required threat_name, but the agent's
    // Get-MpThreatDetection path doesn't populate it (the name lives in a
    // separate catalog). That filter dropped every threat row -- exactly why
    // the audit found 1 row 4 months old. Fall back to "Threat <id>" so the
    // row lands; the UI shows the ID, operator can still investigate.
    if (Array.isArray(body.threats) && body.threats.length > 0) {
        const allowedSeverity = new Set(["Unknown","Low","Moderate","High","Severe"]);
        const allowedStatus   = new Set(["Active","Removed","Quarantined","Allowed","Blocked","Cleaning","Resolved"]);

        // v0.6.1: server-side severity fallback. If the agent shipped
        // 'Unknown' (older agent, or a fresh detection where Defender hadn't
        // populated SeverityID yet), infer from the Defender threat_name
        // prefix. The prefix taxonomy is stable across Defender catalog
        // updates: Virus / Trojan / Backdoor / HackTool etc. are Microsoft's
        // own classification. This is a floor, not a ceiling -- if the agent
        // already produced High, we keep High.
        const inferSeverityFromName = (name: string | null | undefined): string => {
            if (!name) return "Unknown";
            const n = name.toLowerCase();
            if (n.startsWith("virus:")        || n.startsWith("ransom:"))     return "Severe";
            if (n.startsWith("trojan:")       || n.startsWith("trojandownloader:") ||
                n.startsWith("trojandropper:")|| n.startsWith("backdoor:")    ||
                n.startsWith("hacktool:")     || n.startsWith("worm:")        ||
                n.startsWith("rootkit:")      || n.startsWith("ransomware:")  ||
                n.startsWith("remoteaccess:") || n.startsWith("exploit:"))    return "High";
            if (n.startsWith("pua:")          || n.startsWith("pup:")         ||
                n.startsWith("adware:")       || n.startsWith("monitortool:")) return "Moderate";
            if (n.startsWith("misleading:")   || n.startsWith("constructor:"))return "Low";
            return "Unknown";
        };

        const rows = body.threats
            .filter(t => t && t.threat_id)
            .map(t => {
                const reportedSev = allowedSeverity.has(String(t.severity)) ? String(t.severity) : "Unknown";
                const name = t.threat_name ? String(t.threat_name) : `Threat ${String(t.threat_id)}`;
                const finalSev = reportedSev === "Unknown" ? inferSeverityFromName(name) : reportedSev;
                return {
                    endpoint_id: endpoint.id,
                    threat_id:   String(t.threat_id),
                    threat_name: name,
                    severity:    finalSev,
                    category:    t.category ? String(t.category) : null,
                    status:      allowedStatus.has(String(t.status)) ? String(t.status) : "Active",
                    initial_detection_time:         t.initial_detection_time ?? null,
                    last_threat_status_change_time: t.last_threat_status_change_time ?? null,
                    resources:   t.resources ?? null,
                    raw_data:    t.raw_data ?? t,
                };
            });
        if (rows.length > 0) {
            const { error: tErr } = await supabase
                .from("endpoint_threats")
                .upsert(rows, { onConflict: "endpoint_id,threat_id", ignoreDuplicates: false });
            if (tErr) console.error("endpoint_threats upsert", tErr);
            else console.log(`agent-heartbeat: threats upserted=${rows.length} for endpoint ${endpoint.id}`);
        }
    }

    // 3. Event log entries — dedup index handles re-sends.
    if (Array.isArray(body.event_logs) && body.event_logs.length > 0) {
        const rows = body.event_logs
            .filter(e => e && e.event_id !== undefined && e.event_time)
            .map(e => ({
                endpoint_id:   endpoint.id,
                log_source:    String(e.log_source ?? "Microsoft-Windows-Windows Defender/Operational"),
                event_id:      typeof e.event_id === "number" ? e.event_id : Number(e.event_id),
                level:         String(e.level ?? "Information"),
                message:       String(e.message ?? ""),
                event_time:    e.event_time,
                provider_name: e.provider_name ?? null,
                task_category: e.task_category ?? null,
                raw_data:      e.raw_data ?? null,
            }));
        if (rows.length > 0) {
            const { error: eErr } = await supabase
                .from("endpoint_event_logs")
                .upsert(rows, { onConflict: "endpoint_id,event_id,event_time", ignoreDuplicates: true });
            if (eErr) console.error("endpoint_event_logs upsert", eErr);
        }
    }

    // 4. Software inventory. Replace-mode if software_inventory_complete=true.
    if (Array.isArray(body.software_inventory)) {
        if (body.software_inventory_complete === true) {
            await supabase.from("endpoint_software_inventory").delete().eq("endpoint_id", endpoint.id);
        }
        const rows = body.software_inventory
            .filter(s => s && s.name)
            .map(s => ({
                endpoint_id:      endpoint.id,
                organization_id:  (endpoint as Record<string, unknown>).organization_id as string,
                software_name:    String(s.name).slice(0, 500),
                software_version: s.version ? String(s.version).slice(0, 100) : null,
                publisher:        s.publisher ? String(s.publisher).slice(0, 500) : null,
                install_date:     s.install_date ? String(s.install_date).slice(0, 50) : null,
                architecture:     s.architecture ? String(s.architecture).slice(0, 20) : null,
            }));
        if (rows.length > 0) {
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const { error: sErr } = await supabase.from("endpoint_software_inventory").insert(batch);
                if (sErr) console.error("software_inventory insert", sErr);
            }
        }
    }

    // ── v0.4.5 EDR-tier additions ──────────────────────────────────────

    // 5. Process creation events (Windows Security event 4688) — high-value
    //    LOLBin / parent-child telemetry. Stored in endpoint_event_logs so it
    //    surfaces in the existing event-log viewer + threat hunting UI.
    if (Array.isArray(body.process_events) && body.process_events.length > 0) {
        const rows = body.process_events
            .filter(e => e && e.event_time)
            .map(e => ({
                endpoint_id:   endpoint.id,
                log_source:    "Microsoft-Windows-Security-Auditing",
                event_id:      4688,
                level:         "Information",
                message:       String(e.command_line ?? e.exe_path ?? ""),
                event_time:    e.event_time,
                provider_name: "Microsoft-Windows-Security-Auditing",
                task_category: "Process Creation",
                raw_data:      e,
            }));
        if (rows.length > 0) {
            const { error: pErr } = await supabase
                .from("endpoint_event_logs")
                .upsert(rows, { onConflict: "endpoint_id,event_id,event_time", ignoreDuplicates: true });
            if (pErr) console.error("process_events upsert", pErr);
        }
    }

    // 6. Persistence snapshot (registry Run keys / services / scheduled tasks).
    //    Agent ships only when the canonicalised hash differs from prior, so
    //    server-side de-dup is on (endpoint_id, snapshot_hash).
    if (body.persistence_snapshot && typeof body.persistence_snapshot === "object") {
        const ps = body.persistence_snapshot as Record<string, unknown>;
        if (typeof ps.snapshot_hash === "string" && ps.payload) {
            const { error: psErr } = await supabase
                .from("endpoint_persistence_snapshots")
                .upsert({
                    endpoint_id:    endpoint.id,
                    organization_id: (endpoint as Record<string, unknown>).organization_id as string,
                    snapshot_hash:  ps.snapshot_hash,
                    run_key_count:  Number(ps.run_key_count ?? 0),
                    service_count:  Number(ps.service_count ?? 0),
                    task_count:     Number(ps.task_count ?? 0),
                    payload:        ps.payload,
                }, { onConflict: "endpoint_id,snapshot_hash", ignoreDuplicates: true });
            if (psErr) console.error("persistence_snapshot upsert", psErr);
        }
    }

    // 7. WDAC enforce-mode blocked-app events. Auditing of allow/deny outcomes
    //    that surface on the platform's enforce-monitoring page.
    if (Array.isArray(body.wdac_blocks) && body.wdac_blocks.length > 0) {
        const rows = body.wdac_blocks
            .filter(b => b && b.file_path)
            .map(b => ({
                endpoint_id:      endpoint.id,
                organization_id:  (endpoint as Record<string, unknown>).organization_id as string,
                blocked_at:       (typeof b.event_time === "string" ? b.event_time : new Date().toISOString()),
                file_path:        String(b.file_path),
                file_name:        String(b.file_name ?? String(b.file_path).split(/[\\/]/).pop() ?? "unknown"),
                file_hash:        b.file_hash ?? null,
                publisher:        b.publisher ?? null,
                user_name:        b.user_name ?? null,
                parent_process:   b.parent_process ?? null,
            }));
        if (rows.length > 0) {
            const { error: wbErr } = await supabase.from("wdac_block_events").insert(rows);
            if (wbErr) console.error("wdac_block_events insert", wbErr);
        }
    }

    // 7b. Tamper-protection events (v0.6.5+). SCM events 7034/7036/7040/7045
    //     on the MithrasAgent service. The agent only ships events that are
    //     new since the last heartbeat (stateful via tamper-events-state.json),
    //     so each row should be inserted exactly once. The agent record_id is
    //     the SCM RecordId on that host -- unique per (endpoint, record_id).
    //     We dedup defensively via a left-join on title containing the
    //     record_id so a retry won't duplicate.
    if (Array.isArray(body.tamper_events) && body.tamper_events.length > 0) {
        const sevMap: Record<string, string> = {
            'Severe':   'critical',
            'High':     'high',
            'Moderate': 'medium',
            'Low':      'low',
        };
        const orgId = (endpoint as Record<string, unknown>).organization_id as string;

        const titleFor = (t: string): string => {
            switch (t) {
                case 'service_stopped':      return 'Tamper attempt: MithrasAgent service stopped';
                case 'service_stopping':     return 'Tamper attempt: MithrasAgent service stop initiated';
                case 'crashed_unexpectedly': return 'Tamper attempt: MithrasAgent crashed unexpectedly';
                case 'start_type_changed':   return 'Tamper attempt: MithrasAgent start type changed';
                case 'service_installed':    return 'Tamper notice: MithrasAgent service installed';
                default:                     return `Tamper event: ${t}`;
            }
        };

        const rows = body.tamper_events
            .filter(e => e && e.event_type && e.record_id !== undefined)
            .map(e => ({
                organization_id: orgId,
                endpoint_id:     endpoint.id,
                alert_type:      'tamper_attempt',
                severity:        sevMap[String(e.severity)] ?? 'medium',
                title:           titleFor(String(e.event_type)),
                message:         `Event ${e.event_id} (record ${e.record_id}) at ${e.event_time}: ${String(e.message ?? '').slice(0, 400)}`,
                created_at:      (typeof e.event_time === 'string' ? e.event_time : new Date().toISOString()),
            }));

        if (rows.length > 0) {
            // No unique index on alerts -- best effort dedupe by checking for
            // the same (endpoint, alert_type, record_id substring) within the
            // last hour. Cheap enough: the agent only ships a handful per
            // heartbeat in practice (usually zero).
            const fresh: typeof rows = [];
            for (const r of rows) {
                const recMarker = r.message.match(/record (\d+)/)?.[1] ?? '';
                if (!recMarker) { fresh.push(r); continue; }
                const { data: existing } = await supabase
                    .from('alerts')
                    .select('id')
                    .eq('endpoint_id', endpoint.id)
                    .eq('alert_type', 'tamper_attempt')
                    .ilike('message', `%record ${recMarker}%`)
                    .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
                    .limit(1);
                if (!existing || existing.length === 0) fresh.push(r);
            }
            if (fresh.length > 0) {
                const { error: taErr } = await supabase.from('alerts').insert(fresh);
                if (taErr) console.error('tamper_events insert', taErr);
                else console.log(`agent-heartbeat: tamper_events inserted=${fresh.length} for endpoint ${endpoint.id}`);
            }
        }
    }

    // 7c. Ransomware canary trips (v0.6.6+). Strong signal of active
    //     ransomware: the agent's decoy file was modified or deleted in
    //     C:\Users\Public\Documents\ or the hidden ProgramData canary dir.
    //     Always critical. 6-hour idempotency by (endpoint, canary path).
    if (Array.isArray(body.canary_events) && body.canary_events.length > 0) {
        const orgId = (endpoint as Record<string, unknown>).organization_id as string;

        const titleFor = (t: string, p: string): string => {
            const name = p.split(/[\\/]/).pop() || p;
            switch (t) {
                case 'modified': return `Ransomware suspected: canary file "${name}" was modified`;
                case 'deleted':  return `Ransomware suspected: canary file "${name}" was deleted`;
                default:         return `Ransomware suspected: canary file "${name}" tripped (${t})`;
            }
        };

        const fresh: Record<string, unknown>[] = [];
        for (const e of body.canary_events) {
            if (!e || !e.path || !e.event_type) continue;
            // Escape LIKE metacharacters so a compromised agent can't send
            // path="%" to match all canary alert rows (which would suppress
            // future canary alerts for the 6h idempotency window).
            const canaryPath = String(e.path).replace(/[\\%_]/g, (c) => "\\" + c);

            // Idempotency: same canary on same endpoint in last 6 hours = skip.
            const { data: existing } = await supabase
                .from('alerts')
                .select('id')
                .eq('endpoint_id', endpoint.id)
                .eq('alert_type', 'ransomware_canary_tripped')
                .ilike('message', `%${canaryPath}%`)
                .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
                .limit(1);
            if (existing && existing.length > 0) continue;

            fresh.push({
                organization_id: orgId,
                endpoint_id:     endpoint.id,
                alert_type:      'ransomware_canary_tripped',
                severity:        'critical',
                title:           titleFor(String(e.event_type), canaryPath),
                message:         `Canary at ${canaryPath} (${e.event_type}). ` +
                                 `expected_sha256=${e.expected_sha256 ?? 'n/a'} ` +
                                 `observed_sha256=${e.observed_sha256 ?? 'n/a'} ` +
                                 `expected_size=${e.expected_size ?? 'n/a'} ` +
                                 `observed_size=${e.observed_size ?? 'n/a'}. ` +
                                 `This is a strong signal of active ransomware. Isolate this endpoint immediately.`,
                created_at:      (typeof e.event_time === 'string' ? e.event_time : new Date().toISOString()),
            });
        }
        if (fresh.length > 0) {
            const { error: caErr } = await supabase.from('alerts').insert(fresh);
            if (caErr) console.error('canary_events insert', caErr);
            else console.log(`agent-heartbeat: canary_events inserted=${fresh.length} for endpoint ${endpoint.id}`);
        }
    }

    // 7d. Defender state snapshot (v0.6.6+). Latest-wins — we just stamp
    //     the JSON on endpoints. SOC reads endpoints.defender_state for the
    //     triage card; no separate query needed.
    if (body.defender_state && typeof body.defender_state === "object") {
        const { error: dsErr } = await supabase
            .from("endpoints")
            .update({
                defender_state:            body.defender_state,
                defender_state_updated_at: new Date().toISOString(),
            })
            .eq("id", endpoint.id);
        if (dsErr) console.error("defender_state update", dsErr);
    }

    // 8. Agent command results — agent reports outcomes for previously
    //    dispatched commands. Server applies the status / result / error
    //    fields back onto the command row.
    if (Array.isArray(body.command_results) && body.command_results.length > 0) {
        for (const r of body.command_results) {
            const id = (r as Record<string, unknown>).id;
            if (!id) continue;
            const status = String((r as Record<string, unknown>).status ?? "succeeded");
            const ok = status === "succeeded";
            const result = (r as Record<string, unknown>).result ?? null;
            const errMsg = String((r as Record<string, unknown>).error ?? "unknown");

            const { data: cmdRow, error: crErr } = await supabase.from("agent_commands").update({
                status:        ok ? "succeeded" : "failed",
                completed_at:  new Date().toISOString(),
                result,
                error_message: ok ? null : errMsg,
            }).eq("id", id).eq("endpoint_id", endpoint.id).select("command_type").maybeSingle();
            if (crErr) console.error("command_results update", crErr);

            // Side effects per command type. install_mesh_agent /
            // uninstall_mesh_agent flip endpoints.mesh_agent_state so the
            // SOC console reflects the new transport state without polling.
            const cmdType = cmdRow?.command_type;
            if (cmdType === "install_mesh_agent") {
                if (ok) {
                    await supabase.from("endpoints").update({
                        mesh_agent_state:       "installed",
                        mesh_agent_error:       null,
                        mesh_agent_installed_at: new Date().toISOString(),
                    }).eq("id", endpoint.id);
                } else {
                    await supabase.from("endpoints").update({
                        mesh_agent_state: "failed",
                        mesh_agent_error: errMsg.slice(0, 1000),
                    }).eq("id", endpoint.id);
                }
            } else if (cmdType === "uninstall_mesh_agent") {
                if (ok) {
                    await supabase.from("endpoints").update({
                        mesh_agent_state:       "not_installed",
                        mesh_agent_error:       null,
                        mesh_node_id:           null,
                        mesh_agent_installed_at: null,
                    }).eq("id", endpoint.id);
                } else {
                    // Leave state alone on uninstall failure; operator can retry.
                    await supabase.from("endpoints").update({
                        mesh_agent_error: errMsg.slice(0, 1000),
                    }).eq("id", endpoint.id);
                }
            }
        }
    }

    // 9. Dispatch queued commands back to the agent in the heartbeat response.
    //    Pull up to 20 commands in queued state, mark them dispatched, and
    //    include them in the response body for the agent to execute.
    //
    //    Preflight skip: the agent makes one preflight POST on startup with
    //    body { preflight: true } purely to populate its legacy_agent_token
    //    cache before the main loop starts. That handler does NOT process
    //    response.commands — if we dispatch commands here they're silently
    //    lost (marked dispatched, never executed, eventually auto-expired).
    //    Skip the dispatch when the body flag is set.
    let queuedCommands: Array<Record<string, unknown>> = [];
    if (!body.preflight) {
        // Match the legacy agent-api semantic: null expires_at means
        // "never expires", which a plain `.gt(...)` silently excludes.
        // Use OR so non-expiring commands actually dispatch.
        const nowIso = new Date().toISOString();
        const { data: cmds, error: cmdErr } = await supabase
            .from("agent_commands")
            .select("id, command_type, params, issued_at, expires_at, correlation_id")
            .eq("endpoint_id", endpoint.id)
            .eq("status", "queued")
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .order("issued_at", { ascending: true })
            .limit(20);
        if (cmdErr) console.error("agent_commands select", cmdErr);
        if (cmds && cmds.length > 0) {
            queuedCommands = cmds;
            const ids = cmds.map(c => (c as Record<string, unknown>).id);
            const { error: dErr } = await supabase.from("agent_commands")
                .update({ status: "dispatched", dispatched_at: new Date().toISOString() })
                .in("id", ids);
            if (dErr) console.error("agent_commands dispatch update", dErr);
        }
    }

    // App-control state: one merged payload across all rule sets assigned to this endpoint.
    let appControl: unknown = null;
    {
        const { data, error: acErr } = await supabase.rpc('app_control_state_for_endpoint', { p_endpoint_id: endpoint.id });
        if (acErr) console.error('app_control_state_for_endpoint', acErr);
        else appControl = data ?? { mode: 'off' };
    }

    // Auto-update fix #3: also embed latest_version here so the modern agent
    // can short-circuit the separate /agent-version-check round trip and
    // self-update directly from the heartbeat response when one is available.
    const reportedVersion = body.agent_version || endpoint.agent_version || null;
    let latestVersionPayload: Record<string, unknown> | null = null;
    try {
        const { data: latest } = await supabase
            .from("agent_versions")
            .select("version, download_url, sha256")
            .eq("runtime", "powershell")
            .eq("channel", "stable")
            .eq("is_active", true)
            .order("published_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (latest) {
            latestVersionPayload = {
                version:      latest.version,
                download_url: latest.download_url,
                sha256:       latest.sha256,
                upgrade_available: reportedVersion ? cmpSemver(reportedVersion, latest.version) < 0 : false,
            };
        }
    } catch (e) {
        console.error("latest_version lookup failed", e);
    }

    // v0.7.0: dynamic next_check_in. When there are STILL queued/dispatched
    // commands beyond what we just dispatched (e.g., commands arriving while
    // the agent was mid-loop), push the agent to come back fast. Same when
    // we just dispatched any commands -- the agent will be shipping the
    // result on the next heartbeat anyway, so 5s gets the SOC operator
    // near-instant feedback instead of waiting up to 60s.
    let nextCheckIn = NEXT_CHECK_IN_SECONDS;
    if (queuedCommands.length > 0) {
        // We just handed out commands; agent processes them and ships
        // results soon. Bring it back fast.
        nextCheckIn = 5;
    } else {
        // No commands this heartbeat, but check if more arrived while we
        // were assembling the response.
        const { count: pendingCount } = await supabase
            .from("agent_commands")
            .select("id", { count: "exact", head: true })
            .eq("endpoint_id", endpoint.id)
            .in("status", ["queued", "dispatched"])
            .gt("expires_at", new Date().toISOString());
        if ((pendingCount ?? 0) > 0) nextCheckIn = 5;
    }

    return jsonResponse({
        commands: queuedCommands,
        next_check_in: nextCheckIn,
        app_control: appControl,
        latest_version: latestVersionPayload,
        // v0.7.5: return the legacy bearer token so HMAC-only agents (no
        // agent.json on disk) can populate their in-memory cache and reach
        // the legacy agent-api endpoints used by 6 subsystems (firewall
        // audit shipping, app whitelist policy + pass, WDAC fetch, DNS
        // policy fetch, Sysmon ship, policy enforcement). Without this,
        // fresh enrolments silently no-op those subsystems forever.
        legacy_agent_token: endpoint.agent_token ?? null,
    }, 200, origin);
});

// Strict numeric-tuple compare on the first three dotted segments.
function cmpSemver(a: string | null, b: string | null): number {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da !== db) return da < db ? -1 : 1;
    }
    return 0;
}
