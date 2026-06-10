// POST /functions/v1/m365-posture-advisor
//
// Generates a Claude-driven (OpenAI today) "fix plan" for a posture snapshot.
// Reads the latest snapshot + per-control findings + control descriptions,
// asks the LLM to pick the top 3 priority actions and write plain-English
// remediation steps for each. Citation discipline: every claim must cite a
// control_id that exists in the snapshot's findings — we strip claims that
// reference invalid controls before persisting.
//
// Body: { snapshot_id: uuid }
// Auth: user JWT, must be admin of the snapshot's org (or super-admin).
// Returns: { advice_id, payload } or { error }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured, getOpenAiModel } from "../_shared/ai-llm.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

interface AdvicePayload {
    summary: string;
    risk_level: "critical" | "high" | "medium" | "low";
    top_actions: Array<{
        control_id: string;
        why_now: string;
        steps: string[];
        est_minutes: number;
    }>;
    shoutouts: string[];   // controls the org is doing well — recognition matters
}

const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "risk_level", "top_actions", "shoutouts"],
    properties: {
        summary: {
            type: "string",
            description: "2-3 sentence executive summary of the M365 security posture for a non-technical SMB owner.",
        },
        risk_level: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
        },
        top_actions: {
            type: "array",
            description: "Top 3 prioritised actions. Each MUST cite an existing control_id from the provided findings list.",
            minItems: 0,
            maxItems: 3,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["control_id", "why_now", "steps", "est_minutes"],
                properties: {
                    control_id:  { type: "string" },
                    why_now:     { type: "string" },
                    steps:       { type: "array", items: { type: "string" } },
                    est_minutes: { type: "integer", minimum: 1, maximum: 480 },
                },
            },
        },
        shoutouts: {
            type: "array",
            description: "Controls the org is passing — recognise the good work. Each entry references a control_id.",
            items: { type: "string" },
        },
    },
} as const;

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    let body: { snapshot_id?: string } = {};
    try { body = await req.json(); } catch {}
    if (!body.snapshot_id) return json({ error: "snapshot_id_required" }, 400, origin);

    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "auth_required" }, 401, origin);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "auth_invalid" }, 401, origin);

    // Load snapshot + findings + control details server-side.
    const { data: snap } = await admin
        .from("m365_posture_snapshots")
        .select("*")
        .eq("id", body.snapshot_id)
        .maybeSingle();
    if (!snap) return json({ error: "snapshot_not_found" }, 404, origin);

    // Authz: super-admin OR member of the snapshot's org.
    const { data: isSuper } = await admin.from("super_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (!isSuper) {
        const { data: m } = await admin
            .from("organization_memberships")
            .select("role")
            .eq("user_id", userData.user.id)
            .eq("organization_id", (snap as any).organization_id)
            .in("role", ["admin", "owner"])
            .maybeSingle();
        if (!m) return json({ error: "forbidden_admin_only" }, 403, origin);
    }

    const { data: findings } = await admin
        .from("m365_posture_findings")
        .select("control_id, status, score, details, error_message")
        .eq("snapshot_id", body.snapshot_id);
    if (!findings || findings.length === 0) {
        return json({ error: "no_findings_to_advise_on" }, 400, origin);
    }
    const { data: controls } = await admin
        .from("m365_posture_controls")
        .select("control_id, category, title, description, weight, impact_if_failed, remediation_steps");

    const validIds = new Set<string>(findings.map(f => f.control_id));

    const systemPrompt = `You are a senior Microsoft 365 security consultant advising a small/medium business.

You will be given the results of a security posture scan. Your job:
1. Write a 2-3 sentence summary for the business owner — plain English, no jargon.
2. Pick the top 3 actions (NOT all findings — only the three the owner should do this week).
3. For each, explain WHY this matters NOW (one sentence on real-world risk), then give 3-6 concrete steps a sys admin can follow.
4. Recognise what they're already doing well.

CITATION RULE (strict): every top_action.control_id MUST match a control_id present in the findings provided. Every shoutout MUST match a control_id present in the findings. Do not invent IDs.

Bias toward action: prefer 3 medium-impact wins they'll actually do over 3 critical-impact items they'll defer.`;

    const userPrompt = JSON.stringify({
        snapshot: {
            overall_score: snap.overall_score,
            secure_score: snap.secure_score,
            secure_score_max: snap.secure_score_max,
            pass_count: snap.pass_count,
            warn_count: snap.warn_count,
            fail_count: snap.fail_count,
        },
        controls: (controls ?? []).filter(c => validIds.has(c.control_id)),
        findings: findings,
    });

    const model = await getOpenAiModel();
    const t0 = Date.now();
    const result = await callLlmStructured<AdvicePayload>({
        systemPrompt,
        userPrompt,
        schemaName: "m365_posture_advice",
        schema: SCHEMA as unknown as Record<string, unknown>,
        timeoutMs: 60_000,
        feature: "posture_advisor",
        organizationId: (snap as any).organization_id,
    });
    const latency = Date.now() - t0;

    if (!result.ok) {
        return json({ error: result.error ?? "llm_failed" }, 502, origin);
    }

    // Citation enforcement: drop any top_action / shoutout referencing an
    // unknown control_id. If everything gets dropped we mark the response
    // empty so the UI can offer a re-run with different scope.
    // (Fixed: callLlmStructured returns `.data`, not `.value` — the typo
    // meant `payload.top_actions = …` threw TypeError at runtime, so the
    // advice insert never landed.)
    const payload = result.data;
    payload.top_actions = (payload.top_actions ?? []).filter(a => validIds.has(a.control_id));
    payload.shoutouts   = (payload.shoutouts   ?? []).filter(id => validIds.has(id));

    // Persist (replacing any existing advice for this snapshot).
    await admin.from("m365_posture_advice").delete().eq("snapshot_id", body.snapshot_id);
    const { data: advice } = await admin.from("m365_posture_advice").insert({
        snapshot_id: body.snapshot_id,
        model,
        cost_cents:  result.costCents ?? null,
        latency_ms:  latency,
        payload:     payload,
        requested_by: userData.user.id,
    }).select().single();

    return json({ advice_id: (advice as any)?.id, payload }, 200, origin);
});
