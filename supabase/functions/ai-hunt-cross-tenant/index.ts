// POST /functions/v1/ai-hunt-cross-tenant
//
// HUNT AGENT — phase 4 of the autonomous SOC.
//
// Cross-tenant pattern detection. Runs every 15 minutes via pg_cron. Finds
// indicators (IPs in v1; hashes, domains, command lines, mailbox rules in
// later iterations) that appear across 2+ tenants in the recent window
// and elevates them to hunt_findings.
//
// New findings get a single LLM enrichment call (analyst-style: what's this
// IP, what's the pattern, what should ops do). Subsequent observations of
// the same indicator update counters without spending more LLM money.
//
// This is the cross-tenant network-effect agent that compounds Mithras's
// detection edge with every new customer.
//
// Auth: x-mithras-soc-secret (pg_cron via pg_net) or service-role JWT
// (admin manual fire).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Detection thresholds. Tune via platform_settings if v1 produces too much or
// too little noise.
const LOOKBACK_HOURS                = 1;     // window to scan
const MIN_TENANTS_FOR_FINDING       = 2;     // IP must appear in at least N distinct tenants
const MIN_EVENTS_FOR_FINDING        = 5;     // ...and produce at least M events total
const MAX_LLM_ENRICHMENTS_PER_RUN   = 10;    // cost cap per cycle (10 × ~$0.0003 each)
const ENRICHMENT_MODEL_DEFAULT      = "gpt-4o-mini";

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

function isAuthorised(req: Request): boolean {
    const socSecret = req.headers.get("x-mithras-soc-secret") ?? "";
    if (SOC_SECRET && socSecret === SOC_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt === SUPABASE_SERVICE_KEY) return true;
    return false;
}

// ============================================================================
// LLM enrichment
// ============================================================================

interface EnrichmentResponse {
    severity: "low" | "medium" | "high" | "critical";
    confidence: number;
    summary: string;
    recommended_action: string;
}

const ENRICHMENT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["severity","confidence","summary","recommended_action"],
    properties: {
        severity:   { type: "string", enum: ["low","medium","high","critical"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        summary:    { type: "string", maxLength: 600 },
        recommended_action: { type: "string", maxLength: 400 },
    },
};

const ENRICHMENT_SYSTEM_PROMPT = `You are the Hunt Agent. You enrich a single
cross-tenant indicator finding. The indicator has appeared in firewall traffic
across multiple Mithras customers in the last hour — that's the signal we're
asking you to characterise.

RULES:
1. Set severity based on the indicator's likely impact + the spread:
   - critical: known C2 / malware staging / active campaign
   - high:    consistent with attack infrastructure, multi-tenant impact
   - medium:  suspicious but ambiguous (could be benign scanning)
   - low:     likely benign (CDN, well-known service, etc.)
2. Confidence reflects how sure you are about the classification (0.0-1.0).
   Confidence > 0.85 needs unambiguous indicators. Below 0.5 is "weak guess".
3. Summary is 2-3 sentences a SOC operator would read in their morning queue.
   No SOC jargon for the customer-facing layer — that's the Comms Agent's job.
   This summary is operator-internal.
4. recommended_action is one concrete sentence: block at firewall, monitor,
   correlate with X, etc. Don't say "investigate further" — be specific.
5. Output ONLY the JSON. No prose.`;

async function getEnrichmentModel(): Promise<string> {
    const { data } = await supabase
        .from("platform_settings").select("value")
        .eq("key", "ai_hunt_model").maybeSingle();
    const v = (data?.value as string | undefined)?.trim();
    return v || ENRICHMENT_MODEL_DEFAULT;
}

function buildEnrichmentPrompt(args: {
    ip: string;
    tenant_count: number;
    event_count: number;
    sample_events: Array<{ port: number; protocol: string; direction: string; service: string }>;
}): string {
    const out: string[] = [];
    out.push(`## Cross-tenant IP finding`);
    out.push(`Indicator type: IP address`);
    out.push(`Value: ${args.ip}`);
    out.push(`Distinct affected tenants: ${args.tenant_count}`);
    out.push(`Total firewall events in window: ${args.event_count}`);
    out.push("");
    out.push(`## Sample events (port + direction + service):`);
    for (const e of args.sample_events.slice(0, 10)) {
        out.push(`  ${e.direction} ${e.protocol}/${e.port} (${e.service})`);
    }
    out.push("");
    out.push(`Classify this indicator now. Output only the JSON.`);
    return out.join("\n");
}

// ============================================================================
// Detection
// ============================================================================

interface IpCluster {
    ip: string;
    tenant_ids: string[];
    event_count: number;
    sample_events: Array<{ port: number; protocol: string; direction: string; service: string }>;
}

async function detectCrossTenantIps(): Promise<IpCluster[]> {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    // For v1 we always use the inline aggregator. A pl/pgsql helper RPC
    // would be a perf win at high firewall volume but the inline path is
    // correct, simpler, and easier to reason about while we tune thresholds.
    return await detectCrossTenantIpsInline(since);
}

// Fallback when the helper RPC isn't deployed. Pulls all firewall events in
// the window and clusters in-process — fine for low-volume tenants, slower
// at scale. The helper RPC ships in a follow-up migration; this lets us
// run today.
async function detectCrossTenantIpsInline(since: string): Promise<IpCluster[]> {
    // Pull a bounded set; if there's a noisy IP this still finds it.
    const { data, error } = await supabase
        .from("firewall_audit_logs")
        .select("organization_id, remote_address, remote_port, protocol, direction, service_name")
        .gte("event_time", since)
        .not("remote_address", "is", null)
        .neq("remote_address", "")
        .limit(20000);
    if (error) throw error;

    const byIp = new Map<string, IpCluster>();
    for (const row of (data ?? []) as Array<Record<string, any>>) {
        const ip = String(row.remote_address);
        if (!ip || ip === "0.0.0.0" || ip === "::") continue;
        let cluster = byIp.get(ip);
        if (!cluster) {
            cluster = { ip, tenant_ids: [], event_count: 0, sample_events: [] };
            byIp.set(ip, cluster);
        }
        cluster.event_count++;
        const orgId = String(row.organization_id);
        if (!cluster.tenant_ids.includes(orgId)) cluster.tenant_ids.push(orgId);
        if (cluster.sample_events.length < 10) {
            cluster.sample_events.push({
                port: Number(row.remote_port ?? 0),
                protocol: String(row.protocol ?? ""),
                direction: String(row.direction ?? ""),
                service: String(row.service_name ?? ""),
            });
        }
    }

    return Array.from(byIp.values())
        .filter(c => c.tenant_ids.length >= MIN_TENANTS_FOR_FINDING && c.event_count >= MIN_EVENTS_FOR_FINDING);
}

// ============================================================================
// Persist / upsert findings
// ============================================================================

async function upsertFinding(cluster: IpCluster, windowStart: string, windowEnd: string): Promise<{
    finding_id: string;
    is_new: boolean;
}> {
    // Look up existing open finding for this IP first. Manual upsert because
    // the conditional unique index doesn't play nicely with .upsert(onConflict).
    const { data: existing } = await supabase
        .from("hunt_findings")
        .select("id, affected_tenant_ids, sample_event_count")
        .eq("finding_kind", "cross_tenant_ip")
        .filter("shared_indicator->>value", "eq", cluster.ip)
        .eq("status", "open")
        .maybeSingle();

    if (existing) {
        // Merge tenant lists, bump counters, extend window.
        const mergedTenants = Array.from(new Set([...(existing.affected_tenant_ids ?? []), ...cluster.tenant_ids]));
        await supabase.from("hunt_findings").update({
            affected_tenant_ids: mergedTenants,
            tenant_count: mergedTenants.length,
            sample_event_count: (existing.sample_event_count ?? 0) + cluster.event_count,
            event_window_end: windowEnd,
            updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        return { finding_id: existing.id as string, is_new: false };
    }

    // Fresh finding.
    const { data: row, error } = await supabase.from("hunt_findings").insert({
        finding_kind:       "cross_tenant_ip",
        shared_indicator:   { value: cluster.ip, kind: "ip" },
        affected_tenant_ids: cluster.tenant_ids,
        tenant_count:       cluster.tenant_ids.length,
        sample_event_count: cluster.event_count,
        event_window_start: windowStart,
        event_window_end:   windowEnd,
        severity:           "medium",  // tentative until enrichment lands
        status:             "open",
    }).select("id").single();
    if (error || !row) throw error ?? new Error("insert returned no row");
    return { finding_id: row.id as string, is_new: true };
}

async function enrichFinding(findingId: string, cluster: IpCluster): Promise<void> {
    const model = await getEnrichmentModel();
    const result = await callLlmStructured<EnrichmentResponse>({
        systemPrompt: ENRICHMENT_SYSTEM_PROMPT,
        userPrompt:   buildEnrichmentPrompt({
            ip: cluster.ip,
            tenant_count: cluster.tenant_ids.length,
            event_count: cluster.event_count,
            sample_events: cluster.sample_events,
        }),
        schema: ENRICHMENT_SCHEMA,
        schemaName: "hunt_enrichment",
        model,
        timeoutMs: 30_000,
        feature: "hunt",
        organizationId: null,  // fleet-wide cost — no per-org attribution
    });

    if (!result.ok) {
        await supabase.from("hunt_findings").update({
            enrichment_model: model,
            // confidence + summary stay null — operator sees raw counts until next cycle
        }).eq("id", findingId);
        return;
    }

    await supabase.from("hunt_findings").update({
        severity:          result.data.severity,
        confidence:        result.data.confidence,
        summary:           result.data.summary,
        recommended_action: result.data.recommended_action,
        enrichment_model:  result.model,
        enrichment_cost_microcents: Math.round((result.costCents ?? 0) * 1000),
        enriched_at:       new Date().toISOString(),
    }).eq("id", findingId);

    // Mirror to hunt_iocs catalog so future triage decisions can reference it.
    await supabase.from("hunt_iocs").upsert({
        ioc_type:   "ip",
        ioc_value:  cluster.ip,
        finding_id: findingId,
        last_seen_at: new Date().toISOString(),
        tenant_count: cluster.tenant_ids.length,
        confidence: result.data.confidence,
        notes:      result.data.summary,
        enabled:    result.data.confidence >= 0.6 && result.data.severity !== "low",
    }, { onConflict: "ioc_type,ioc_value" });
}

// ============================================================================
// MAIN
// ============================================================================

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    const t0 = Date.now();
    const windowEnd   = new Date().toISOString();
    const windowStart = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    let clusters: IpCluster[];
    try {
        clusters = await detectCrossTenantIps();
    } catch (e) {
        return jsonResponse({ error: "detection_failed", details: e instanceof Error ? e.message : String(e) }, 500, origin);
    }

    let newCount   = 0;
    let updateCount = 0;
    let enrichCount = 0;

    for (const cluster of clusters) {
        try {
            const { finding_id, is_new } = await upsertFinding(cluster, windowStart, windowEnd);
            if (is_new) {
                newCount++;
                if (enrichCount < MAX_LLM_ENRICHMENTS_PER_RUN) {
                    await enrichFinding(finding_id, cluster);
                    enrichCount++;
                }
            } else {
                updateCount++;
            }
        } catch (e) {
            console.error("hunt_finding_upsert_failed", { ip: cluster.ip, error: e instanceof Error ? e.message : String(e) });
        }
    }

    return jsonResponse({
        ok: true,
        clusters_detected: clusters.length,
        new_findings: newCount,
        updated_findings: updateCount,
        llm_enrichments: enrichCount,
        window_start: windowStart,
        window_end:   windowEnd,
        elapsed_ms:   Date.now() - t0,
    }, 200, origin);
});
