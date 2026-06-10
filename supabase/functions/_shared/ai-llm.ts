// Shared LLM helpers for the AI SOC functions (triage + investigation).
//
// Three responsibilities:
//   1. Look up the OpenAI key + model from platform_settings.
//   2. Call the OpenAI chat completions endpoint with structured-output
//      schema enforcement and a strict timeout.
//   3. Estimate cost in US cents from the token counts the API returns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Fallback rates baked into the binary — only used if the ai_model_rates
// table is unreachable (DB hiccup, cold-start race). Authoritative values
// live in public.ai_model_rates and are editable from /admin/ai-costs.
// Numbers are USD per 1M tokens.
const MODEL_RATES_FALLBACK: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini":  { input: 0.15,  output: 0.60 },
    "gpt-4o":       { input: 2.50,  output: 10.00 },
    "gpt-4.1-mini": { input: 0.15,  output: 0.60 },
    "gpt-4.1":      { input: 2.00,  output: 8.00 },
    "gpt-5-mini":   { input: 0.25,  output: 2.00 },
    "gpt-5":        { input: 1.25,  output: 10.00 },
    "o4-mini":      { input: 1.10,  output: 4.40 },
};

// 60-second cache so we don't hit the DB on every LLM call. Edits propagate
// to all running isolates within a minute.
const RATE_CACHE_TTL_MS = 60_000;
let _rateCache: { rates: Record<string, { input: number; output: number }>; expiresAt: number } | null = null;

async function loadModelRates(): Promise<Record<string, { input: number; output: number }>> {
    const now = Date.now();
    if (_rateCache && _rateCache.expiresAt > now) return _rateCache.rates;
    try {
        const { data, error } = await supabase
            .from("ai_model_rates")
            .select("model, usd_per_million_input, usd_per_million_output");
        if (error) throw error;
        const rates: Record<string, { input: number; output: number }> = { ...MODEL_RATES_FALLBACK };
        for (const r of data ?? []) {
            rates[r.model as string] = {
                input:  Number(r.usd_per_million_input),
                output: Number(r.usd_per_million_output),
            };
        }
        _rateCache = { rates, expiresAt: now + RATE_CACHE_TTL_MS };
        return rates;
    } catch (e) {
        // DB unreachable — return baked-in fallback so the LLM call still
        // succeeds with an approximate cost. We don't cache the failure;
        // next call retries.
        console.warn("ai-llm: ai_model_rates lookup failed, using fallback:", e instanceof Error ? e.message : String(e));
        return MODEL_RATES_FALLBACK;
    }
}

async function estimateCostCents(model: string, promptTokens: number, completionTokens: number): Promise<number> {
    const rates = await loadModelRates();
    const rate = rates[model] ?? rates["gpt-4o-mini"] ?? MODEL_RATES_FALLBACK["gpt-4o-mini"];
    const usd = (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
    return Math.max(0, Math.round(usd * 100));
}

// Micro-cents granularity for the ledger. A single ~5k-token gpt-4.1-mini
// call costs ~96 µ¢; rounding to integer cents loses every per-call signal.
// 1 cent = 1000 µ¢.
async function estimateCostMicroCents(model: string, promptTokens: number, completionTokens: number): Promise<number> {
    const rates = await loadModelRates();
    const rate = rates[model] ?? rates["gpt-4o-mini"] ?? MODEL_RATES_FALLBACK["gpt-4o-mini"];
    const usd = (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
    return Math.max(0, Math.round(usd * 100_000));  // USD → cents → µ¢
}

// ----------------------------------------------------------------------------
// Universal LLM-call ledger
// ----------------------------------------------------------------------------
// Every callLlmStructured/callLlmText writes one row to ai_llm_calls,
// regardless of which feature called it. Fire-and-forget — a ledger insert
// failure must never block the LLM response.

async function logLlmCall(row: {
    organization_id: string | null;
    feature: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_cents: number;
    cost_microcents: number;
    latency_ms: number | null;
    status: "success" | "error" | "refusal";
    error_message: string | null;
}): Promise<void> {
    try {
        await supabase.from("ai_llm_calls").insert(row);
    } catch (e) {
        console.warn("ai-llm: ledger insert failed:", e instanceof Error ? e.message : String(e));
    }
}

export async function getOpenAiKey(): Promise<string | null> {
    const env = Deno.env.get("OPENAI_API_KEY");
    if (env) return env;
    const { data } = await supabase
        .from("platform_settings").select("value").eq("key", "openai_api_key").maybeSingle();
    return (data?.value as string) ?? null;
}

export async function getOpenAiModel(fallback = "gpt-4o-mini"): Promise<string> {
    const env = Deno.env.get("OPENAI_MODEL");
    if (env) return env;
    const { data } = await supabase
        .from("platform_settings").select("value").eq("key", "openai_model").maybeSingle();
    const v = (data?.value as string | undefined)?.trim();
    return v || fallback;
}

export interface LlmResult<T> {
    ok: true;
    data: T;
    raw: unknown;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costCents: number;
    latencyMs: number;
}

export interface LlmError {
    ok: false;
    error: string;
    raw?: unknown;
    model?: string;
    latencyMs?: number;
}

interface CallLlmOpts {
    systemPrompt: string;
    userPrompt: string;
    schema: Record<string, unknown>;
    schemaName: string;
    model?: string;
    timeoutMs?: number;
    // Attribution for the ai_llm_calls ledger. feature is the SOC capability
    // making the call (triage|investigation|posture_advisor|cve_scan|
    // cve_protect|cve_mitigation|security_advisor|report_exec_summary|
    // incident_triage|other). organizationId scopes spend per tenant for
    // billing & per-org budgets. Both default to safe values if the caller
    // hasn't been updated yet.
    feature?: string;
    organizationId?: string | null;
}

/**
 * Call the OpenAI chat completions endpoint with strict JSON-schema output
 * mode. Schema is enforced server-side by OpenAI — the response will match
 * or the call returns an error. We still defensive-parse on our side.
 *
 * Returns parsed data with full token + cost accounting on success.
 */
export async function callLlmStructured<T>(opts: CallLlmOpts): Promise<LlmResult<T> | LlmError> {
    const key = await getOpenAiKey();
    if (!key) return { ok: false, error: "no_openai_key_configured" };
    const model = opts.model ?? await getOpenAiModel();

    // gpt-5 and o-series both accept structured outputs but reject custom
    // `temperature`. gpt-4-series accept both. Omit temperature for either
    // family to avoid the 400 invalid_request_error.
    const useJsonSchema  = true;
    const useTemperature = !/^o\d|^gpt-5/.test(model);

    const body: Record<string, unknown> = {
        model,
        messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user",   content: opts.userPrompt },
        ],
    };
    body.response_format = {
        type: "json_schema",
        json_schema: {
            name: opts.schemaName,
            strict: true,
            schema: opts.schema,
        },
    };
    if (useTemperature) body.temperature = 0.1;

    const t0 = Date.now();
    const feature = opts.feature ?? "other";
    const organizationId = opts.organizationId ?? null;
    try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
        const latencyMs = Date.now() - t0;
        if (!resp.ok) {
            const text = await resp.text();
            const err = `openai_${resp.status}: ${text.slice(0, 300)}`;
            await logLlmCall({ organization_id: organizationId, feature, model, prompt_tokens: 0, completion_tokens: 0, cost_cents: 0, cost_microcents: 0, latency_ms: latencyMs, status: "error", error_message: err });
            return { ok: false, error: err, model, latencyMs };
        }
        const raw = await resp.json();
        const content = raw?.choices?.[0]?.message?.content;
        const refusal = raw?.choices?.[0]?.message?.refusal;
        if (refusal) {
            const err = `model_refusal: ${String(refusal).slice(0, 200)}`;
            await logLlmCall({ organization_id: organizationId, feature, model, prompt_tokens: 0, completion_tokens: 0, cost_cents: 0, cost_microcents: 0, latency_ms: latencyMs, status: "refusal", error_message: err });
            return { ok: false, error: err, raw, model, latencyMs };
        }
        if (!content) {
            await logLlmCall({ organization_id: organizationId, feature, model, prompt_tokens: 0, completion_tokens: 0, cost_cents: 0, cost_microcents: 0, latency_ms: latencyMs, status: "error", error_message: "openai_empty_response" });
            return { ok: false, error: "openai_empty_response", raw, model, latencyMs };
        }
        let parsed: T;
        const cleaned = String(content).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        try {
            parsed = JSON.parse(cleaned) as T;
        } catch {
            const usage = raw?.usage ?? {};
            const pt = Number(usage.prompt_tokens ?? 0);
            const ct = Number(usage.completion_tokens ?? 0);
            await logLlmCall({ organization_id: organizationId, feature, model,
                prompt_tokens: pt, completion_tokens: ct,
                cost_cents: await estimateCostCents(model, pt, ct),
                cost_microcents: await estimateCostMicroCents(model, pt, ct),
                latency_ms: latencyMs, status: "error", error_message: "json_parse_failed" });
            return { ok: false, error: "json_parse_failed", raw, model, latencyMs };
        }
        const usage = raw?.usage ?? {};
        const promptTokens = Number(usage.prompt_tokens ?? 0);
        const completionTokens = Number(usage.completion_tokens ?? 0);
        const costCents = await estimateCostCents(model, promptTokens, completionTokens);
        const costMicroCents = await estimateCostMicroCents(model, promptTokens, completionTokens);
        await logLlmCall({ organization_id: organizationId, feature, model, prompt_tokens: promptTokens, completion_tokens: completionTokens, cost_cents: costCents, cost_microcents: costMicroCents, latency_ms: latencyMs, status: "success", error_message: null });
        return { ok: true, data: parsed, raw, model, promptTokens, completionTokens, costCents, latencyMs };
    } catch (e) {
        const latencyMs = Date.now() - t0;
        const err = e instanceof Error ? e.message : String(e);
        await logLlmCall({ organization_id: organizationId, feature, model, prompt_tokens: 0, completion_tokens: 0, cost_cents: 0, cost_microcents: 0, latency_ms: latencyMs, status: "error", error_message: err });
        return { ok: false, error: err, model, latencyMs };
    }
}

// ----------------------------------------------------------------------------
// Citation validation
// ----------------------------------------------------------------------------

export interface Citation {
    table: string;
    row_id: string;
}

const CITATION_ALLOWLIST = new Set([
    "alerts",
    "endpoint_status",
    "endpoint_threats",
    "endpoint_event_logs",
    "endpoints",
    "sysmon_events",
    "firewall_audit_logs",
    "m365_sign_in_events",
    "m365_audit_events",
    "m365_mailbox_rules",
    "m365_oauth_grants",
    "incidents",
]);

// LLMs frequently submit close-but-not-exact table names ("alert" for
// "alerts", "endpoint" for "endpoints"). Map a handful of common variants
// onto the canonical name so we don't drop valid citations on a typo.
const TABLE_ALIASES: Record<string, string> = {
    "alert":               "alerts",
    "endpoint":            "endpoints",
    "endpoint_event_log":  "endpoint_event_logs",
    "endpoint_threat":     "endpoint_threats",
    "sysmon_event":        "sysmon_events",
    "firewall_audit_log":  "firewall_audit_logs",
    "m365_sign_in_event":  "m365_sign_in_events",
    "m365_audit_event":    "m365_audit_events",
    "m365_mailbox_rule":   "m365_mailbox_rules",
    "m365_oauth_grant":    "m365_oauth_grants",
    "incident":            "incidents",
};

function canonicalTable(name: string): string | null {
    const trimmed = name.trim().toLowerCase();
    if (CITATION_ALLOWLIST.has(trimmed)) return trimmed;
    const aliased = TABLE_ALIASES[trimmed];
    if (aliased && CITATION_ALLOWLIST.has(aliased)) return aliased;
    return null;
}

// Every table on the citation allowlist uses UUID primary keys. Force-check
// the row_id against the UUID format BEFORE hitting the database so a
// malformed string can't trigger a cast-error path or accidentally match
// rows in a future non-UUID schema.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify the cited row actually exists. Returns true if and only if:
 *   - the citation object is well-formed
 *   - the table is on the allowlist (after alias resolution)
 *   - the row_id is a valid UUID
 *   - a row with that ID exists
 * Failed lookups are treated as "no citation." Citations that pass through
 * this function have their `table` field normalised to the canonical name.
 */
export async function validateCitation(c: Citation): Promise<boolean> {
    if (!c || typeof c.table !== "string" || typeof c.row_id !== "string") return false;
    if (!UUID_RE.test(c.row_id)) return false;
    const canonical = canonicalTable(c.table);
    if (!canonical) return false;
    // Normalise in place so downstream code sees the canonical name.
    c.table = canonical;
    const { data } = await supabase
        .from(canonical).select("id").eq("id", c.row_id).maybeSingle();
    return !!data;
}

/**
 * Filter a list of "claim" objects (each containing a citation) down to
 * the ones whose citations validate. Used to drop claims the LLM made up.
 */
export async function filterToValidClaims<T extends { citation?: Citation }>(claims: T[]): Promise<T[]> {
    const checks = await Promise.all(
        claims.map(async (c) => (c.citation ? await validateCitation(c.citation) : false)),
    );
    return claims.filter((_, i) => checks[i]);
}
