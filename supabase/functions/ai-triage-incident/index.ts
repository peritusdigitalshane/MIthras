// POST /functions/v1/ai-triage-incident
// Body: { incident_id: string }
//
// Looks up incident + related threat + recent endpoint events, calls the LLM
// with a constrained JSON schema, persists the assessment to
// public.incident_ai_assessments. Cached: if a row already exists for the
// incident, returns it without re-querying the LLM unless force=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function getOpenAiKey(): Promise<string | null> {
    const env = Deno.env.get("OPENAI_API_KEY");
    if (env) return env;
    const { data } = await supabase.from("platform_settings").select("value").eq("key", "openai_api_key").maybeSingle();
    return (data?.value as string) ?? null;
}

async function getOpenAiModel(): Promise<string> {
    const env = Deno.env.get("OPENAI_MODEL");
    if (env) return env;
    try {
        const { data } = await supabase.from("platform_settings").select("value").eq("key", "openai_model").maybeSingle();
        const v = (data?.value as string | undefined)?.trim();
        if (v) return v;
    } catch { /* fall through */ }
    return "gpt-4o-mini";
}

interface AiResult {
    summary: string;
    suggested_action: string;
    suggested_command: "isolate_network" | "kill_process" | "quarantine_file" | "run_quick_scan" | "run_full_scan" | "collect_persistence" | "none";
    mitre_tags: string[];
    confidence: "high" | "medium" | "low";
    severity_override?: "Severe" | "High" | "Moderate" | "Low";
}

async function callLLM(prompt: string): Promise<{ ok: true; data: AiResult; raw: unknown; model: string } | { ok: false; error: string }> {
    const key = await getOpenAiKey();
    if (!key) return { ok: false, error: "no_openai_key_configured" };
    const model = await getOpenAiModel();
    const supportsResponseFormat = !/^o1|^o4|^gpt-5/.test(model);
    const supportsTemperature    = !/^o1|^o4|^gpt-5/.test(model);

    const body: Record<string, unknown> = {
        model,
        messages: [
            { role: "system", content:
`You are a Tier-1 SOC analyst for an MSP security platform. You triage incidents and produce structured JSON. Be concise, concrete, and skeptical. Refuse to speculate beyond the evidence given.

Output JSON shape (strict):
{
  "summary": "2-sentence plain-English explanation of what happened and why it matters",
  "suggested_action": "one-sentence what the analyst should do next",
  "suggested_command": "one of: isolate_network | kill_process | quarantine_file | run_quick_scan | run_full_scan | collect_persistence | none",
  "mitre_tags": ["TXXXX", "TXXXX"],
  "confidence": "high | medium | low",
  "severity_override": "Severe | High | Moderate | Low"   (optional - only set if you disagree with the source severity)
}` },
            { role: "user", content: prompt },
        ],
    };
    if (supportsResponseFormat) body.response_format = { type: "json_object" };
    if (supportsTemperature)    body.temperature = 0.2;

    try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45_000),
        });
        if (!resp.ok) {
            const text = await resp.text();
            return { ok: false, error: `openai_${resp.status}: ${text.slice(0, 200)}` };
        }
        const raw = await resp.json();
        const content = raw?.choices?.[0]?.message?.content;
        if (!content) return { ok: false, error: "openai_empty_response" };
        // If response_format wasn't supported, the model may wrap JSON in code fences.
        const cleaned = String(content).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        let parsed: AiResult;
        try { parsed = JSON.parse(cleaned); }
        catch { return { ok: false, error: "json_parse_failed" }; }
        // light validation
        if (!parsed.summary || !parsed.suggested_action) {
            return { ok: false, error: "schema_violation" };
        }
        return { ok: true, data: parsed, raw, model };
    } catch (e) {
        return { ok: false, error: (e instanceof Error ? e.message : String(e)) };
    }
}

function htmlEscape(s: unknown) {
    return String(s ?? "").replaceAll("\n", " ").slice(0, 800);
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    // Auth: this function is only invoked from the SOC console via user
    // JWT — there is no cron caller, so the previous service-key-as-bearer
    // back-channel was an unused attack-surface. Removed in Wave 14.
    // If a future cron caller is added, use the x-mithras-cron-secret
    // header pattern (see generate-customer-report) rather than the
    // service-role key.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = false;
    let userId: string | null = null;
    if (!token) return jsonResponse({ error: "missing_token" }, 401, origin);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResponse({ error: "invalid_token" }, 401, origin);
    userId = user.id;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const incidentId = String(body.incident_id ?? "");
    const force = body.force === true;
    if (!incidentId) return jsonResponse({ error: "incident_id_required" }, 400, origin);

    // Look up incident + authorise.
    const { data: incident, error: incErr } = await supabase
        .from("incidents").select("*").eq("id", incidentId).maybeSingle();
    if (incErr || !incident) return jsonResponse({ error: "incident_not_found" }, 404, origin);

    if (!isServiceCall) {
        // member-of-org check
        const { data: isSa } = await supabase.from("super_admins").select("user_id").eq("user_id", userId!).maybeSingle();
        if (!isSa) {
            const { data: member } = await supabase.from("organization_memberships")
                .select("organization_id").eq("user_id", userId!).eq("organization_id", incident.organization_id).maybeSingle();
            if (!member) return jsonResponse({ error: "forbidden" }, 403, origin);
        }
    }

    // B1: plan-gate. AI triage is a paid (ai_security_advisor) feature; free-tier
    // orgs cannot burn LLM budget. Service-role calls bypass for ops tooling.
    if (!isServiceCall) {
        const { data: allowed } = await supabase
            .rpc("org_has_feature", { _org_id: incident.organization_id, _feature: "ai_security_advisor" });
        if (allowed === false) {
            return jsonResponse({
                error: "plan_feature_required",
                feature: "ai_security_advisor",
                hint: "Upgrade to a paid plan to use AI incident triage.",
            }, 402, origin);
        }
    }

    // Cache hit?
    if (!force) {
        const { data: existing } = await supabase.from("incident_ai_assessments").select("*").eq("incident_id", incidentId).maybeSingle();
        if (existing && existing.summary) {
            return jsonResponse({ cached: true, assessment: existing }, 200, origin);
        }
    }

    // Gather context.
    const { data: threat } = await supabase.from("endpoint_threats").select("*").eq("id", incident.threat_id ?? "").maybeSingle();
    const { data: endpoint } = await supabase.from("endpoints").select("hostname, os_version, runtime, last_seen_at").eq("id", incident.endpoint_id ?? "").maybeSingle();
    const { data: recentEvents } = await supabase
        .from("endpoint_event_logs")
        .select("event_id, level, message, event_time, log_source")
        .eq("endpoint_id", incident.endpoint_id ?? "")
        .gte("event_time", new Date(new Date(incident.opened_at).getTime() - 10 * 60 * 1000).toISOString())
        .lte("event_time", new Date(new Date(incident.opened_at).getTime() +  5 * 60 * 1000).toISOString())
        .order("event_time", { ascending: false })
        .limit(20);
    const { data: postureRow } = await supabase
        .from("endpoint_status").select("realtime_protection_enabled, antivirus_enabled, behavior_monitor_enabled, antivirus_signature_age, am_running_mode, collected_at")
        .eq("endpoint_id", incident.endpoint_id ?? "")
        .order("collected_at", { ascending: false }).limit(1).maybeSingle();

    const prompt =
`Triage this incident.

INCIDENT
  id:           ${incident.id}
  title:        ${htmlEscape(incident.title)}
  description:  ${htmlEscape(incident.description)}
  kind:         ${incident.kind}
  severity:     ${incident.severity}
  opened_at:    ${incident.opened_at}

ENDPOINT
  hostname:     ${htmlEscape(endpoint?.hostname)}
  os:           ${htmlEscape(endpoint?.os_version)}
  runtime:      ${htmlEscape(endpoint?.runtime)}
  last_seen_at: ${htmlEscape(endpoint?.last_seen_at)}

DEFENDER POSTURE (latest snapshot)
  RTP enabled:      ${postureRow?.realtime_protection_enabled ?? "unknown"}
  AV enabled:       ${postureRow?.antivirus_enabled ?? "unknown"}
  Behavior monitor: ${postureRow?.behavior_monitor_enabled ?? "unknown"}
  Sig age (days):   ${postureRow?.antivirus_signature_age ?? "unknown"}
  Running mode:     ${htmlEscape(postureRow?.am_running_mode)}

THREAT (source: Defender)
  threat_name:   ${htmlEscape(threat?.threat_name)}
  category:      ${htmlEscape(threat?.category)}
  status:        ${htmlEscape(threat?.status)}
  resources:     ${JSON.stringify(threat?.resources ?? null).slice(0, 400)}

NEAR-TIME DEFENDER EVENTS (±10 min around incident open)
${(recentEvents ?? []).map((e, i) => `  ${i+1}. id=${e.event_id} t=${e.event_time} src=${e.log_source}\n     ${htmlEscape(e.message).slice(0, 200)}`).join("\n")}
${(recentEvents ?? []).length === 0 ? "  (no nearby events captured)" : ""}

Produce the strict JSON.`;

    const result = await callLLM(prompt);
    const orgId = incident.organization_id as string;

    if (!result.ok) {
        await supabase.from("incident_ai_assessments").upsert({
            incident_id: incidentId,
            organization_id: orgId,
            error_message: result.error,
            model: "gpt-4o-mini",
            generated_at: new Date().toISOString(),
        }, { onConflict: "incident_id" });
        return jsonResponse({ error: "llm_call_failed", details: result.error }, 502, origin);
    }

    const row = {
        incident_id:       incidentId,
        organization_id:   orgId,
        summary:           result.data.summary,
        suggested_action:  result.data.suggested_action,
        suggested_command: result.data.suggested_command,
        mitre_tags:        result.data.mitre_tags ?? [],
        confidence:        result.data.confidence,
        severity_override: result.data.severity_override ?? null,
        raw_response:      result.raw,
        model:             result.model,
        generated_at:      new Date().toISOString(),
        error_message:     null,
    };

    const { error: upsertErr } = await supabase.from("incident_ai_assessments")
        .upsert(row, { onConflict: "incident_id" });
    if (upsertErr) {
        return jsonResponse({ error: "persist_failed", details: upsertErr.message }, 500, origin);
    }

    return jsonResponse({ cached: false, assessment: row }, 200, origin);
});
