// POST /functions/v1/ai-comms-notify
//
// CUSTOMER COMMS AGENT — phase 5 of the autonomous SOC.
//
// Drafts a customer-facing email when:
//   * The Response Agent fired an autonomous action (include one-click
//     "Confirm threat" / "Mark false positive" buttons)
//   * Consensus said true_positive but no auto-response fired (notification
//     only, no buttons — explains the situation, links to the SOC console)
//
// Input:
//   { triage_decision_id: uuid, action_id?: uuid, confirmation_token?: string }
// confirmation_token is the RAW token returned by ai-response-execute. It's
// embedded in the one-click URL and never persisted anywhere except the
// customer's inbox.
//
// Auth: x-mithras-soc-secret (orchestrator) or service-role JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";
import { sanitizeHeader, encodeHeader, isValidEmail, escapeHtml } from "../_shared/mime-safe.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_SECRET           = Deno.env.get("AI_SOC_POLL_SECRET") ?? "";
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const SOC_URL              = Deno.env.get("SOC_URL")  ?? "https://soc.mithras.com.au";
const API_BASE             = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";
const COMMS_MODEL_DEFAULT  = "gpt-4o-mini";  // copywriting doesn't need a flagship model

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
// LLM email drafting
// ============================================================================

interface EmailDraft {
    subject: string;
    preheader: string;
    summary_paragraph: string;
    what_we_saw_paragraph: string;
    multi_agent_paragraph: string;
    what_we_did_paragraph: string | null;
    what_you_should_do_paragraph: string;
}

const EMAIL_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["subject","preheader","summary_paragraph","what_we_saw_paragraph",
               "multi_agent_paragraph","what_we_did_paragraph","what_you_should_do_paragraph"],
    properties: {
        subject:                       { type: "string", maxLength: 120 },
        preheader:                     { type: "string", maxLength: 140 },
        summary_paragraph:             { type: "string", maxLength: 400 },
        what_we_saw_paragraph:         { type: "string", maxLength: 600 },
        multi_agent_paragraph:         { type: "string", maxLength: 400 },
        what_we_did_paragraph:         { type: ["string","null"], maxLength: 400 },
        what_you_should_do_paragraph:  { type: "string", maxLength: 400 },
    },
};

const SYSTEM_PROMPT = `You are the Customer Comms Agent for the Mithras autonomous SOC.

Your job is to draft a single email to a small-business customer that
clearly explains a security incident their fleet has just hit. The
recipient may be a CEO, an office manager, or a part-time IT contact — write
for that audience, not for a Tier-3 SOC analyst.

RULES:
1. PLAIN ENGLISH. No "MITRE T1059", no "C2 beaconing", no SOC jargon unless
   you immediately translate it. "Process executed via PowerShell with
   suspicious arguments" not "T1059.001 native PowerShell C2".
2. CALM, FACTUAL TONE. The customer is already worried; don't make it worse
   with breathless drama. State what happened, what we did, what they should
   do. No "URGENT" headlines, no fear-mongering.
3. NO INVENTED FACTS. Stick to what the provided context says. If the
   reasoning is thin, write a thinner email.
4. RESPECT THE STRUCTURE: produce six fields exactly as the schema asks for.
   Each paragraph is 2-4 sentences max. Don't repeat content between
   paragraphs.
5. THE MULTI-AGENT PARAGRAPH is what makes Mithras different from a normal
   SOC tool — explain in one short paragraph that three independent AI
   agents reviewed this. Mention the consensus + agreement plainly:
   "All three agents agreed", "Two agents agreed, the third raised doubts",
   "Our adversarial agent tried to refute the verdict and couldn't", etc.
6. SUBJECT LINE: factual, names the action (e.g. "Mithras isolated
   payroll-laptop-3 after detecting unauthorized PowerShell"). No emojis,
   no "URGENT" or "ACTION REQUIRED".
7. Output ONLY JSON. No prose outside the schema.`;

interface DraftContext {
    org_name: string;
    alert_title: string;
    alert_severity: string;
    alert_type: string;
    hostname: string;
    triage_verdict: string;
    triage_confidence: number;
    final_verdict: string;
    final_confidence: number;
    disagreement_detected: boolean;
    adversarial_refuted: boolean | null;
    consensus_reasoning: string;
    triage_summary: string;
    triage_key_indicators: Array<{ indicator: string }>;
    action_kind: string | null;
    action_rollback_minutes: number | null;
}

function buildUserPrompt(ctx: DraftContext): string {
    const out: string[] = [];
    out.push(`## Customer + alert context`);
    out.push(`Organisation: ${ctx.org_name}`);
    out.push(`Alert: ${ctx.alert_title}`);
    out.push(`Severity: ${ctx.alert_severity}`);
    out.push(`Type: ${ctx.alert_type}`);
    out.push(`Affected endpoint hostname: ${ctx.hostname}`);
    out.push("");
    out.push(`## Multi-agent verdict trail`);
    out.push(`Triage agent: ${ctx.triage_verdict} at ${Math.round(ctx.triage_confidence * 100)}% confidence`);
    out.push(`Final consensus: ${ctx.final_verdict} at ${Math.round(ctx.final_confidence * 100)}% confidence`);
    out.push(`Disagreement detected: ${ctx.disagreement_detected ? "YES" : "no"}`);
    out.push(`Adversarial agent refuted: ${ctx.adversarial_refuted === true ? "YES" : ctx.adversarial_refuted === false ? "no (couldn't refute)" : "did not run"}`);
    out.push(`Consensus reasoning: ${ctx.consensus_reasoning}`);
    out.push("");
    out.push(`## Triage agent summary`);
    out.push(ctx.triage_summary);
    out.push("");
    out.push(`## Key indicators`);
    for (const k of ctx.triage_key_indicators.slice(0, 6)) {
        out.push(`- ${k.indicator}`);
    }
    out.push("");
    if (ctx.action_kind) {
        out.push(`## Autonomous response taken`);
        out.push(`Action: ${ctx.action_kind}`);
        out.push(`This action will automatically reverse in ${ctx.action_rollback_minutes ?? "?"} minutes unless the customer confirms the threat.`);
        out.push("");
        out.push(`Include a what_we_did_paragraph. The email will have two buttons:`);
        out.push(`  - "Confirm threat (keep ${ctx.action_kind})" -> customer confirms; auto-rollback is cancelled`);
        out.push(`  - "Mark false positive" -> action is reversed immediately`);
        out.push(`Mention these in what_you_should_do_paragraph.`);
    } else {
        out.push(`## No autonomous action`);
        out.push(`Set what_we_did_paragraph to null. Explain in what_you_should_do_paragraph that the customer should review the alert in the Mithras console at ${SOC_URL}/alerts and decide.`);
    }
    out.push("");
    out.push(`Draft the email now. Output JSON matching the schema.`);
    return out.join("\n");
}

async function getCommsModel(): Promise<string> {
    const { data } = await supabase
        .from("platform_settings").select("key,value")
        .in("key", ["ai_comms_model", "openai_model"]);
    const map: Record<string, string> = {};
    for (const r of (data ?? [])) map[r.key as string] = String(r.value ?? "").trim();
    return map.ai_comms_model || map.openai_model || COMMS_MODEL_DEFAULT;
}

// ============================================================================
// SMTP — reuse the notify-alert STARTTLS flow inline to keep this function
// self-contained. Same pattern as supabase/functions/notify-alert/index.ts.
// ============================================================================

interface SmtpSettings {
    host: string; port: number; username: string; password: string;
    fromEmail: string; fromName: string; useStarttls: boolean;
}

async function getSmtpSettings(): Promise<SmtpSettings | { error: string }> {
    const { data } = await supabase
        .from("platform_settings").select("key,value")
        .in("key", ["smtp_provider","smtp_host","smtp_port","smtp_username","smtp_password","smtp_from_email","smtp_from_name","smtp_use_starttls"]);
    const m: Record<string, unknown> = {};
    for (const r of (data ?? [])) m[r.key as string] = r.value;
    if ((m.smtp_provider ?? "disabled") === "disabled") return { error: "smtp_disabled" };
    if (!m.smtp_host || !m.smtp_username || !m.smtp_password) return { error: "smtp_not_configured" };
    return {
        host: String(m.smtp_host),
        port: Number(m.smtp_port ?? 587),
        username: String(m.smtp_username),
        password: String(m.smtp_password),
        fromEmail: String(m.smtp_from_email ?? m.smtp_username),
        fromName:  String(m.smtp_from_name ?? "Mithras"),
        useStarttls: m.smtp_use_starttls !== false,
    };
}

async function sendStarttls(s: SmtpSettings, recipients: string[], rfcBody: string): Promise<void> {
    const conn = await Deno.connect({ hostname: s.host, port: s.port });
    const enc = new TextEncoder(); const dec = new TextDecoder();
    const buf = new Uint8Array(8192);
    const read   = async () => { const n = await conn.read(buf); if (!n) return ""; return dec.decode(buf.subarray(0, n)); };
    const write  = async (l: string) => { await conn.write(enc.encode(l + "\r\n")); };
    const expect = async (cp: string) => { const r = await read(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await expect("220"); await write(`EHLO mithras.com.au`); await expect("250");
    if (!s.useStarttls) { try { conn.close(); } catch {} throw new Error("non_tls_send_refused"); }
    await write("STARTTLS"); await expect("220");
    const tls = await Deno.startTls(conn, { hostname: s.host });
    const tEnc = new TextEncoder(); const tDec = new TextDecoder(); const tBuf = new Uint8Array(8192);
    const tRead = async () => { const n = await tls.read(tBuf); if (!n) return ""; return tDec.decode(tBuf.subarray(0, n)); };
    const tWrite = async (l: string) => { await tls.write(tEnc.encode(l + "\r\n")); };
    const tExpect = async (cp: string) => { const r = await tRead(); if (!r.startsWith(cp)) throw new Error(`expected ${cp}, got: ${r.trim()}`); return r; };

    await tWrite(`EHLO mithras.com.au`); await tExpect("250");
    await tWrite("AUTH LOGIN"); await tExpect("334");
    await tWrite(btoa(s.username)); await tExpect("334");
    await tWrite(btoa(s.password)); await tExpect("235");
    await tWrite(`MAIL FROM:<${s.fromEmail}>`); await tExpect("250");
    for (const r of recipients) { await tWrite(`RCPT TO:<${r}>`); await tExpect("250"); }
    await tWrite("DATA"); await tExpect("354");
    const safe = rfcBody.replace(/^\./gm, "..");
    await tls.write(tEnc.encode(safe + "\r\n.\r\n")); await tExpect("250");
    await tWrite("QUIT");
    try { tls.close(); } catch { /* QUIT already closed it */ }
}

// ============================================================================
// MAIN
// ============================================================================

Deno.serve(async (req) => {
    const preflight = handlePreflight(req); if (preflight) return preflight;
    const origin = req.headers.get("origin");
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    if (!isAuthorised(req)) return jsonResponse({ error: "forbidden" }, 403, origin);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const triageDecisionId = String(body.triage_decision_id ?? "");
    const actionId         = body.action_id ? String(body.action_id) : null;
    const confirmationToken = body.confirmation_token ? String(body.confirmation_token) : null;
    if (!triageDecisionId) return jsonResponse({ error: "triage_decision_id_required" }, 400, origin);

    // === Load full context ===
    const { data: td } = await supabase
        .from("ai_triage_decisions")
        .select("id, alert_id, organization_id, verdict, confidence, summary, key_indicators, reasoning_steps, final_verdict, final_confidence, disagreement_detected, adversarial_refuted, consensus_reasoning")
        .eq("id", triageDecisionId).maybeSingle();
    if (!td) return jsonResponse({ error: "triage_decision_not_found" }, 404, origin);

    const { data: alert } = await supabase
        .from("alerts").select("id, title, severity, alert_type, message, endpoint_id, created_at")
        .eq("id", td.alert_id).maybeSingle();
    if (!alert) return jsonResponse({ error: "alert_not_found" }, 404, origin);

    const [orgRes, endpointRes, recipRes, actionRes] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", td.organization_id).maybeSingle(),
        alert.endpoint_id
            ? supabase.from("endpoints").select("hostname").eq("id", alert.endpoint_id).maybeSingle()
            : Promise.resolve({ data: null }),
        supabase.from("org_alert_recipients")
            .select("email, name, min_severity")
            .eq("organization_id", td.organization_id)
            .eq("enabled", true),
        actionId
            ? supabase.from("ai_agent_actions").select("action_kind, auto_rollback_minutes").eq("id", actionId).maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    const orgName  = (orgRes.data?.name as string) ?? "your organisation";
    const hostname = (endpointRes as any).data?.hostname ?? "an endpoint";
    const action   = (actionRes as any).data;
    const emails = ((recipRes.data ?? []) as Array<{ email: string }>)
        .map(r => String(r.email).trim().toLowerCase())
        .filter(isValidEmail);

    if (emails.length === 0) {
        return jsonResponse({ ok: true, skipped: "no_recipients" }, 200, origin);
    }

    // === Draft the email via LLM ===
    const draftCtx: DraftContext = {
        org_name: orgName,
        alert_title: alert.title as string,
        alert_severity: String(alert.severity ?? ""),
        alert_type: alert.alert_type as string,
        hostname,
        triage_verdict: (td.verdict as string) ?? "unknown",
        triage_confidence: Number(td.confidence ?? 0),
        final_verdict: (td.final_verdict as string) ?? (td.verdict as string) ?? "unknown",
        final_confidence: Number(td.final_confidence ?? td.confidence ?? 0),
        disagreement_detected: td.disagreement_detected === true,
        adversarial_refuted: td.adversarial_refuted as boolean | null,
        consensus_reasoning: (td.consensus_reasoning as string) ?? "",
        triage_summary: (td.summary as string) ?? "",
        triage_key_indicators: Array.isArray(td.key_indicators) ? td.key_indicators as Array<{ indicator: string }> : [],
        action_kind: action?.action_kind ?? null,
        action_rollback_minutes: action?.auto_rollback_minutes ?? null,
    };

    const model = await getCommsModel();
    const llm = await callLlmStructured<EmailDraft>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt:   buildUserPrompt(draftCtx),
        schema:       EMAIL_SCHEMA,
        schemaName:   "incident_email_draft",
        model,
        timeoutMs:    45_000,
        feature:      "comms",
        organizationId: td.organization_id as string,
    });

    if (!llm.ok) {
        await supabase.from("ai_agent_comms").insert({
            triage_decision_id: triageDecisionId,
            action_id: actionId,
            alert_id: td.alert_id,
            organization_id: td.organization_id,
            recipients: emails,
            subject: "[draft failed]",
            body_html: "(LLM call failed)",
            body_text: "(LLM call failed)",
            status: "failed",
            error_message: llm.error.slice(0, 800),
            model: llm.model ?? model,
        });
        return jsonResponse({ error: "llm_failed", details: llm.error }, 502, origin);
    }
    const draft = llm.data;

    // === Build HTML + text bodies ===
    const confirmUrl  = actionId && confirmationToken
        ? `${API_BASE}/functions/v1/ai-comms-action?t=${encodeURIComponent(confirmationToken)}&a=confirm`
        : null;
    const overrideUrl = actionId && confirmationToken
        ? `${API_BASE}/functions/v1/ai-comms-action?t=${encodeURIComponent(confirmationToken)}&a=override`
        : null;

    const htmlButtons = confirmUrl && overrideUrl ? `
<table cellspacing="0" cellpadding="0" border="0" style="margin:24px 0">
  <tr>
    <td style="padding-right:8px">
      <a href="${escapeHtml(confirmUrl)}" style="background:#dc2626;color:white;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Confirm threat (keep action)</a>
    </td>
    <td>
      <a href="${escapeHtml(overrideUrl)}" style="background:#f1f5f9;color:#0f172a;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;border:1px solid #cbd5e1">Mark as false positive</a>
    </td>
  </tr>
</table>` : "";

    const html = `<!doctype html><html><body style="font-family:Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:680px;margin:24px auto;padding:0 18px;line-height:1.5">
<div style="font-size:11px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">Mithras Threat Defence · ${escapeHtml(orgName)}</div>
<h2 style="color:#0f172a;margin:0 0 8px 0">${escapeHtml(draft.subject)}</h2>
<p style="color:#64748b;margin:0 0 24px 0;font-size:13px">${escapeHtml(draft.preheader)}</p>

<p style="font-size:15px">${escapeHtml(draft.summary_paragraph)}</p>
<p style="font-size:15px">${escapeHtml(draft.what_we_saw_paragraph)}</p>
<p style="font-size:15px">${escapeHtml(draft.multi_agent_paragraph)}</p>
${draft.what_we_did_paragraph ? `<p style="font-size:15px">${escapeHtml(draft.what_we_did_paragraph)}</p>` : ""}
<p style="font-size:15px;font-weight:600">${escapeHtml(draft.what_you_should_do_paragraph)}</p>

${htmlButtons}

<p style="color:#475569;font-size:13px;margin-top:32px">
<strong>Need a human?</strong> Reply to this email — we'll respond within 15 minutes.<br>
Or open the incident in the SOC: <a href="${SOC_URL}/alerts" style="color:#0ea5e9">${SOC_URL}/alerts</a>
</p>
<p style="color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:24px">
Reviewed by Triage + Verification + Adversarial AI agents · Final verdict: ${escapeHtml(draftCtx.final_verdict.replace(/_/g, " "))} at ${Math.round(draftCtx.final_confidence * 100)}% confidence<br>
Mithras Threat Defence · <a href="${SITE_URL}" style="color:#64748b">${SITE_URL}</a>
</p>
</body></html>`;

    const text = [
        `${draft.subject}`,
        "",
        draft.summary_paragraph,
        "",
        draft.what_we_saw_paragraph,
        "",
        draft.multi_agent_paragraph,
        "",
        draft.what_we_did_paragraph ?? "",
        "",
        draft.what_you_should_do_paragraph,
        "",
        confirmUrl ? `Confirm threat (keep action):  ${confirmUrl}` : "",
        overrideUrl ? `Mark as false positive:       ${overrideUrl}` : "",
        "",
        `Reply to this email for a human within 15 minutes.`,
        `Open in SOC: ${SOC_URL}/alerts`,
        "",
        `— Mithras Threat Defence (reviewed by 3 AI agents — final: ${draftCtx.final_verdict} at ${Math.round(draftCtx.final_confidence * 100)}%)`,
    ].filter(Boolean).join("\n");

    // === Persist the draft (before send so even a send failure leaves a record) ===
    const { data: commsRow } = await supabase.from("ai_agent_comms").insert({
        triage_decision_id: triageDecisionId,
        action_id: actionId,
        alert_id: td.alert_id,
        organization_id: td.organization_id,
        recipients: emails,
        subject: draft.subject,
        body_html: html,
        body_text: text,
        body_markdown: null,
        status: "drafted",
        model: llm.model,
        prompt_tokens: llm.promptTokens,
        completion_tokens: llm.completionTokens,
        cost_microcents: Math.round((llm.costCents ?? 0) * 1000),
        latency_ms: llm.latencyMs,
        raw_response: llm.raw,
    }).select("id").single();

    // === Send ===
    const smtp = await getSmtpSettings();
    if ("error" in smtp) {
        if (commsRow?.id) {
            await supabase.from("ai_agent_comms")
                .update({ status: "failed", error_message: smtp.error })
                .eq("id", commsRow.id);
        }
        return jsonResponse({ error: smtp.error }, 400, origin);
    }

    const boundary = `alt-${crypto.randomUUID().replace(/-/g, "")}`;
    const headerFromName = encodeHeader(smtp.fromName);
    const headerFromEmail = sanitizeHeader(smtp.fromEmail);
    const headerSubject = encodeHeader(draft.subject);
    const headerTo = emails.map(sanitizeHeader).join(", ");
    const mime = [
        `From: ${headerFromName} <${headerFromEmail}>`,
        `To: ${headerTo}`,
        `Subject: ${headerSubject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        html,
        ``,
        `--${boundary}--`,
    ].join("\r\n");

    try {
        await sendStarttls(smtp, emails, mime);
        if (commsRow?.id) {
            await supabase.from("ai_agent_comms")
                .update({ status: "sent", sent_at: new Date().toISOString() })
                .eq("id", commsRow.id);
        }
        return jsonResponse({
            ok: true,
            comms_id: commsRow?.id,
            recipients: emails.length,
            subject: draft.subject,
        }, 200, origin);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (commsRow?.id) {
            await supabase.from("ai_agent_comms")
                .update({ status: "failed", error_message: msg.slice(0, 800) })
                .eq("id", commsRow.id);
        }
        return jsonResponse({ error: "smtp_send_failed", details: msg }, 502, origin);
    }
});
