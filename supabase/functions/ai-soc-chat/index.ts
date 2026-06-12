// POST /functions/v1/ai-soc-chat
//
// CONVERSATIONAL INTERFACE TO THE AI SOC.
//
// An analyst in the SOC console can ask plain-English questions and get a
// grounded, cited answer back. The agent has read-only access to the
// platform's SOC data (alerts, verdicts, endpoints, incidents,
// investigations, threats). For V1, context is pre-fetched and shipped
// with the prompt — no tool/function calling yet. That keeps latency low,
// cost predictable, and answers reproducible.
//
// Auth: caller's JWT. The function validates the user, scopes the SOC
// context to the orgs they're a member of (or all orgs for super-admins),
// and persists both user + assistant turns to ai_chat_messages with the
// LLM cost ledger.
//
// Body shape:
//   { session_id?: uuid, message: string, organization_id?: uuid }
// Response:
//   { session_id, assistant_message: { content, citations, ... } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { getOpenAiKey, getOpenAiModel } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function authenticateUser(req: Request): Promise<{ userId: string; orgIds: string[]; isSuper: boolean } | null> {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return null;
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;

    const { data: sa } = await supabase.from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const isSuper = !!sa;

    const { data: memberships } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("user_id", user.id);
    const orgIds = (memberships ?? []).map((m: any) => m.organization_id as string);

    return { userId: user.id, orgIds, isSuper };
}

interface CitationChip {
    kind: "alert" | "endpoint" | "incident" | "investigation" | "verdict";
    id: string;
    label: string;
}

interface SocContext {
    recentIncidents: any[];
    recentAlerts: any[];
    recentVerdicts: any[];
    endpointSummary: any[];
}

async function gatherSocContext(orgIds: string[], isSuper: boolean, scopedOrgId?: string): Promise<SocContext> {
    const orgFilter = scopedOrgId ? [scopedOrgId] : (isSuper ? null : orgIds);

    let incidentsQ = supabase
        .from("incidents")
        .select("id, organization_id, alert_id, kind, severity, status, title, commander_summary, playbook_step, opened_at")
        .order("opened_at", { ascending: false })
        .limit(40);
    if (orgFilter) incidentsQ = incidentsQ.in("organization_id", orgFilter);
    const { data: recentIncidents } = await incidentsQ;

    let alertsQ = supabase
        .from("alerts")
        .select("id, organization_id, endpoint_id, alert_type, severity, title, message, acknowledged, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
    if (orgFilter) alertsQ = alertsQ.in("organization_id", orgFilter);
    const { data: recentAlerts } = await alertsQ;

    let verdictsQ = supabase
        .from("ai_triage_decisions")
        .select("id, alert_id, organization_id, final_verdict, final_confidence, disagreement_detected, orchestration_state, created_at")
        .order("created_at", { ascending: false })
        .limit(60);
    if (orgFilter) verdictsQ = verdictsQ.in("organization_id", orgFilter);
    const { data: recentVerdicts } = await verdictsQ;

    let endpointsQ = supabase
        .from("endpoints")
        .select("id, organization_id, hostname, os_version, is_active, agent_version, last_heartbeat_at")
        .order("hostname")
        .limit(50);
    if (orgFilter) endpointsQ = endpointsQ.in("organization_id", orgFilter);
    const { data: endpointSummary } = await endpointsQ;

    return {
        recentIncidents: recentIncidents ?? [],
        recentAlerts: recentAlerts ?? [],
        recentVerdicts: recentVerdicts ?? [],
        endpointSummary: endpointSummary ?? [],
    };
}

function buildContextBlock(ctx: SocContext): string {
    // Compact text representation — keep within the context window. Long
    // descriptions get truncated. The model receives just enough to ground
    // citations.
    const lines: string[] = [];

    lines.push("=== OPEN INCIDENTS (most recent first) ===");
    if (ctx.recentIncidents.length === 0) lines.push("(none)");
    for (const i of ctx.recentIncidents) {
        lines.push(`incidents.id=${i.id} kind=${i.kind} sev=${i.severity} status=${i.status} step=${i.playbook_step ?? "-"} title="${(i.title ?? "").slice(0, 80)}" summary="${(i.commander_summary ?? "").slice(0, 120)}" opened=${i.opened_at}`);
    }

    lines.push("\n=== RECENT ALERTS (most recent first) ===");
    if (ctx.recentAlerts.length === 0) lines.push("(none)");
    for (const a of ctx.recentAlerts) {
        lines.push(`alerts.id=${a.id} type=${a.alert_type} sev=${a.severity} ack=${a.acknowledged} title="${(a.title ?? "").slice(0, 80)}" msg="${(a.message ?? "").slice(0, 140)}" at=${a.created_at}`);
    }

    lines.push("\n=== RECENT TRIAGE VERDICTS ===");
    if (ctx.recentVerdicts.length === 0) lines.push("(none)");
    for (const v of ctx.recentVerdicts) {
        lines.push(`ai_triage_decisions.id=${v.id} alert=${v.alert_id} final=${v.final_verdict} confidence=${v.final_confidence} disagreement=${v.disagreement_detected} state=${v.orchestration_state} at=${v.created_at}`);
    }

    lines.push("\n=== ENDPOINTS ===");
    if (ctx.endpointSummary.length === 0) lines.push("(none)");
    for (const e of ctx.endpointSummary) {
        lines.push(`endpoints.id=${e.id} hostname=${e.hostname} os="${e.os_version ?? "?"}" active=${e.is_active} agent=${e.agent_version ?? "?"} last_hb=${e.last_heartbeat_at ?? "?"}`);
    }

    return lines.join("\n");
}

async function callChatLlm(messages: any[], orgId: string | null): Promise<{ ok: true; content: string; raw: any; model: string; promptTokens: number; completionTokens: number; latencyMs: number } | { ok: false; error: string }> {
    const key = await getOpenAiKey();
    if (!key) return { ok: false, error: "no_openai_key_configured" };
    const model = await getOpenAiModel("gpt-4o-mini");

    const useTemperature = !/^o\d|^gpt-5/.test(model);
    const body: Record<string, unknown> = { model, messages };
    if (useTemperature) body.temperature = 0.2;

    const t0 = Date.now();
    try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        const latencyMs = Date.now() - t0;
        if (!resp.ok) {
            return { ok: false, error: `openai_${resp.status}: ${(await resp.text()).slice(0, 300)}` };
        }
        const raw = await resp.json();
        const content = raw?.choices?.[0]?.message?.content;
        if (!content) return { ok: false, error: "openai_empty_response" };
        const usage = raw?.usage ?? {};
        return {
            ok: true, content: String(content), raw, model,
            promptTokens: Number(usage.prompt_tokens ?? 0),
            completionTokens: Number(usage.completion_tokens ?? 0),
            latencyMs,
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// Validate each extracted citation: the row must exist AND the caller must
// be a member of (or super-admin over) that row's organization. Hallucinated
// IDs the LLM made up get dropped silently so the chat surface never claims
// "alerts.id=xyz says…" for a row that never existed or that lives in some
// other tenant.
const CITATION_KIND_TO_TABLE: Record<CitationChip["kind"], string> = {
    alert:         "alerts",
    endpoint:      "endpoints",
    incident:      "incidents",
    investigation: "ai_investigations",
    verdict:       "ai_triage_decisions",
};

async function validateCitations(
    chips: CitationChip[],
    authed: { userId: string; orgIds: string[]; isSuper: boolean },
): Promise<CitationChip[]> {
    if (chips.length === 0) return chips;
    // Bucket by table so we batch one lookup per kind.
    const buckets: Record<string, CitationChip[]> = {};
    for (const c of chips) {
        const table = CITATION_KIND_TO_TABLE[c.kind];
        if (!table) continue;
        (buckets[table] ??= []).push(c);
    }
    const allowed: CitationChip[] = [];
    for (const [table, bucket] of Object.entries(buckets)) {
        const ids = bucket.map((b) => b.id);
        const { data: rows } = await supabase
            .from(table)
            .select("id, organization_id")
            .in("id", ids);
        const orgById = new Map<string, string>();
        for (const r of (rows ?? [])) {
            orgById.set(String((r as { id: string }).id), String((r as { organization_id: string }).organization_id));
        }
        for (const chip of bucket) {
            const orgId = orgById.get(chip.id);
            if (!orgId) continue;                       // hallucinated / deleted
            if (authed.isSuper)                  { allowed.push(chip); continue; }
            if (authed.orgIds.includes(orgId))   { allowed.push(chip); continue; }
            // Caller can't see this row — silently drop the chip.
        }
    }
    return allowed;
}

// Parse simple "table.id=<uuid>" patterns from the response so we can render
// citation chips. The model is instructed in the system prompt to embed
// citations this way.
function extractCitations(content: string): CitationChip[] {
    const pattern = /(alerts|endpoints|incidents|ai_investigations|ai_triage_decisions)\.id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    const seen = new Set<string>();
    const chips: CitationChip[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        const table = match[1];
        const id = match[2];
        const key = `${table}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = ({
            "alerts":              "alert",
            "endpoints":           "endpoint",
            "incidents":           "incident",
            "ai_investigations":   "investigation",
            "ai_triage_decisions": "verdict",
        } as const)[table];
        if (kind) chips.push({ kind, id, label: id.slice(0, 8) });
    }
    return chips;
}

Deno.serve(async (req) => {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return handlePreflight(req);
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);

    const authed = await authenticateUser(req);
    if (!authed) return jsonResponse({ error: "unauthenticated" }, 401, origin);

    let body: any = {};
    try { body = await req.json(); } catch {}
    const message: string = String(body.message ?? "").trim();
    const sessionIdInput: string | null = body.session_id ?? null;
    const scopedOrgId: string | undefined = body.organization_id;

    if (!message) return jsonResponse({ error: "message_required" }, 400, origin);
    if (message.length > 2000) return jsonResponse({ error: "message_too_long" }, 400, origin);

    // === 0. Authorisation on the org scope ===
    // The caller can pass organization_id to focus the SOC context on a single
    // org. A non-super-admin must be a member of that org — otherwise this
    // would be an IDOR letting any authenticated user read another tenant's
    // alerts/incidents/endpoints via the chat context.
    if (scopedOrgId && !authed.isSuper && !authed.orgIds.includes(scopedOrgId)) {
        return jsonResponse({ error: "forbidden" }, 403, origin);
    }

    // === 0b. Pre-flight LLM budget gate ===
    // Without this, a single user can drive arbitrary OpenAI spend on the
    // chat endpoint — no per-call check, no per-user quota, no circuit
    // breaker. Refuse new calls once the org is over its monthly ceiling
    // (review finding H#8). Use the scoped org if provided, otherwise the
    // user's first org.
    const budgetOrgId = scopedOrgId ?? authed.orgIds[0] ?? null;
    if (budgetOrgId) {
        const { data: remainingCents } = await supabase.rpc(
            "ai_soc_budget_remaining_cents", { p_org_id: budgetOrgId },
        );
        if ((remainingCents ?? 0) <= 0) {
            return jsonResponse({
                error: "ai_budget_exhausted",
                organization_id: budgetOrgId,
                message: "Your organisation has hit its monthly AI budget. Raise the cap from /admin/ai-costs or wait for the next cycle.",
            }, 429, origin);
        }
    }

    // === 1. Resolve or create the chat session ===
    // Sessions are strictly per-user. Super-admins do NOT get to resume
    // another user's session through this endpoint — that would let them
    // write user/assistant turns attributed to the session owner, which
    // breaks audit attribution and pollutes the victim's chat history on
    // their next page load. If audit access to other users' chats is ever
    // needed, expose it as a separate read-only admin endpoint.
    let sessionId: string;
    if (sessionIdInput) {
        const { data: existing } = await supabase
            .from("ai_chat_sessions")
            .select("id, user_id")
            .eq("id", sessionIdInput)
            .maybeSingle();
        if (!existing || existing.user_id !== authed.userId) {
            return jsonResponse({ error: "session_not_found" }, 404, origin);
        }
        sessionId = existing.id;
    } else {
        const titleSeed = message.slice(0, 60);
        const { data: created, error: createErr } = await supabase
            .from("ai_chat_sessions")
            .insert({ user_id: authed.userId, organization_id: scopedOrgId ?? null, title: titleSeed })
            .select("id")
            .single();
        if (createErr || !created) return jsonResponse({ error: `session_create_failed: ${createErr?.message}` }, 500, origin);
        sessionId = created.id;
    }

    // === 2. Persist user turn ===
    await supabase.from("ai_chat_messages").insert({
        session_id: sessionId,
        role: "user",
        content: message,
    });

    // === 3. Load conversation history for context (last 20 turns) ===
    const { data: history } = await supabase
        .from("ai_chat_messages")
        .select("role, content")
        .eq("session_id", sessionId)
        .order("created_at")
        .limit(20);

    // === 4. Gather SOC context ===
    const ctx = await gatherSocContext(authed.orgIds, authed.isSuper, scopedOrgId);
    const contextBlock = buildContextBlock(ctx);

    // === 5. Build messages and call LLM ===
    const systemPrompt = `You are the Mithras AI SOC assistant — an analyst's interface to the platform's data.
You answer questions about alerts, incidents, endpoints, and the AI SOC's verdicts.

Critical rules:
1. ONLY use facts from the SOC CONTEXT below. Do not invent rows, IDs, or details. If the context doesn't contain the answer, say so explicitly.
2. CITE every concrete claim by referencing the row that supports it, using the format "table.id=<uuid>". Examples:
     "alerts.id=4c4bf5ac-3a49-417b-a0b5-8cb5c0ea6983 is a wordpress_brute_force"
     "incidents.id=... is currently in step=contained"
3. Keep responses concise. The reader is an on-call engineer.
4. If the user asks for an action ("isolate X", "send the email"), explain that you can't take actions yet — they should use the SOC console.
5. Plain prose. Markdown is OK for lists and short emphasis only.

SOC CONTEXT (scoped to the user's accessible organisations):
${contextBlock}`;

    const messages: any[] = [
        { role: "system", content: systemPrompt },
        ...(history ?? []).map((h: any) => ({ role: h.role, content: h.content })),
    ];

    // The user turn we just persisted is already in history, no need to add.

    const llmResult = await callChatLlm(messages, scopedOrgId ?? null);

    if (!llmResult.ok) {
        await supabase.from("ai_chat_messages").insert({
            session_id: sessionId,
            role: "assistant",
            content: `I couldn't generate a response: ${llmResult.error}`,
            error_message: llmResult.error,
        });
        return jsonResponse({ error: llmResult.error, session_id: sessionId }, 502, origin);
    }

    const rawCitations = extractCitations(llmResult.content);
    // Server-side citation validation. The LLM extracted these IDs from the
    // context block — but it can also fabricate "table.id=<uuid>" patterns
    // that look real and don't exist. Drop any chip whose row the caller
    // can't actually see (review finding H#10).
    const citations = await validateCitations(rawCitations, authed);

    // Estimate cost — use the same fallback rates as _shared/ai-llm.ts.
    // Quick inline calc to keep this function self-contained.
    const RATES: Record<string, { input: number; output: number }> = {
        "gpt-4o-mini":  { input: 0.15, output: 0.60 },
        "gpt-4o":       { input: 2.50, output: 10.00 },
        "gpt-4.1-mini": { input: 0.15, output: 0.60 },
        "gpt-4.1":      { input: 2.00, output: 8.00 },
        "gpt-5-mini":   { input: 0.25, output: 2.00 },
        "gpt-5":        { input: 1.25, output: 10.00 },
    };
    const rate = RATES[llmResult.model] ?? RATES["gpt-4o-mini"];
    const costUsd = (llmResult.promptTokens / 1_000_000) * rate.input + (llmResult.completionTokens / 1_000_000) * rate.output;
    const costMicrocents = Math.max(0, Math.round(costUsd * 100_000));

    const { data: assistantMsg } = await supabase
        .from("ai_chat_messages")
        .insert({
            session_id: sessionId,
            role: "assistant",
            content: llmResult.content,
            citations: citations as unknown as Record<string, unknown>[],
            model: llmResult.model,
            prompt_tokens: llmResult.promptTokens,
            completion_tokens: llmResult.completionTokens,
            cost_microcents: costMicrocents,
            latency_ms: llmResult.latencyMs,
        })
        .select("id, content, citations, model, prompt_tokens, completion_tokens, cost_microcents, latency_ms, created_at")
        .single();

    // Bump session last_message_at + auto-title if it's the first assistant turn.
    await supabase
        .from("ai_chat_sessions")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", sessionId);

    return jsonResponse({
        session_id: sessionId,
        assistant_message: assistantMsg,
    }, 200, origin);
});
