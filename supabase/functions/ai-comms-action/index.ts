// GET /functions/v1/ai-comms-action?t=<raw_token>&a=confirm|override
//
// Handles the customer's one-click decision from the incident email.
//
//   ?a=confirm  -> Mark action as customer-confirmed. The auto-rollback timer
//                  is cancelled; the action stays in place.
//   ?a=override -> Reverse the action immediately and mark the alert as
//                  acknowledged (false positive).
//
// Renders a small HTML response so the customer sees a real "Thanks, done"
// page in their browser after the click — not a raw JSON blob.
//
// Auth: the raw token itself is the bearer of authority. We hash it server-
// side, look up by hash, and only proceed if the action is still pending
// and within its rollback window. No JWT required because the customer
// clicked an email link.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOC_URL              = Deno.env.get("SOC_URL") ?? "https://soc.mithras.com.au";
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://www.mithras.com.au";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    }[c]!));
}

function htmlPage(opts: {
    title: string;
    tone: "ok" | "info" | "error";
    heading: string;
    body: string;
    cta_href?: string;
    cta_label?: string;
}): Response {
    const accent =
        opts.tone === "ok"    ? "#10b981" :
        opts.tone === "error" ? "#dc2626" :
                                "#0ea5e9";
    const body = `<!doctype html><html><head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:Segoe UI,Roboto,sans-serif;background:#f8fafc;margin:0;padding:32px 16px;color:#0f172a}
  .card{max-width:540px;margin:48px auto;background:white;border-radius:12px;padding:36px;box-shadow:0 4px 24px rgba(15,23,42,0.06)}
  .accent{height:6px;border-radius:3px;background:${accent};margin-bottom:24px}
  h1{margin:0 0 12px 0;font-size:24px}
  p{margin:0 0 16px 0;line-height:1.6;color:#334155}
  .cta{display:inline-block;margin-top:12px;padding:10px 22px;background:${accent};color:white;text-decoration:none;border-radius:6px;font-weight:600}
  footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:24px}
  footer a{color:#64748b}
</style></head><body>
<div class="card">
  <div class="accent"></div>
  <h1>${escapeHtml(opts.heading)}</h1>
  ${opts.body}
  ${opts.cta_href ? `<a class="cta" href="${escapeHtml(opts.cta_href)}">${escapeHtml(opts.cta_label ?? "Continue")}</a>` : ""}
</div>
<footer>Mithras Threat Defence · <a href="${SITE_URL}">${SITE_URL}</a></footer>
</body></html>`;
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
}

const REVERSAL_KIND: Record<string, string | null> = {
    isolate_network:    "release_isolation",
    release_isolation:  "isolate_network",
    kill_process:       null,
    quarantine_file:    null,
    run_quick_scan:     null,
    run_full_scan:      null,
    collect_persistence: null,
    restart_agent:      null,
};

Deno.serve(async (req) => {
    // Only GET is meaningful — the customer's email client opens the URL.
    if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(req.url);
    const rawToken = (url.searchParams.get("t") ?? "").trim();
    const action   = (url.searchParams.get("a") ?? "").trim().toLowerCase();

    if (!rawToken) {
        return htmlPage({
            title: "Mithras — link incomplete",
            tone: "error",
            heading: "This link is incomplete",
            body: `<p>The action link in your email is missing its token. Open the incident directly in the SOC instead.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open SOC",
        });
    }
    if (action !== "confirm" && action !== "override") {
        return htmlPage({
            title: "Mithras — unknown action",
            tone: "error",
            heading: "Unknown action",
            body: `<p>The link you followed asked for an action we don't recognise. Open the incident in the SOC to take action manually.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open SOC",
        });
    }
    if (rawToken.length < 20 || rawToken.length > 64) {
        return htmlPage({
            title: "Mithras — link invalid",
            tone: "error",
            heading: "Link no longer valid",
            body: `<p>This link looks malformed. Open the incident in the SOC to take action.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open SOC",
        });
    }

    const hash = await sha256Hex(rawToken);
    const { data: act } = await supabase
        .from("ai_agent_actions")
        .select("id, organization_id, endpoint_id, alert_id, action_kind, status, rollback_at, linked_command_id, customer_confirmed_at, customer_overrode_at")
        .eq("confirmation_token_hash", hash)
        .maybeSingle();

    if (!act) {
        return htmlPage({
            title: "Mithras — link expired",
            tone: "error",
            heading: "This link has expired",
            body: `<p>The link in your email is no longer valid. It may have already been used, or the rollback window has elapsed.</p>
                   <p>If you still need to act on this incident, open it in the SOC console.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open SOC",
        });
    }

    // Idempotent — already taken.
    if (act.customer_confirmed_at) {
        return htmlPage({
            title: "Mithras — already confirmed",
            tone: "info",
            heading: "Already confirmed",
            body: `<p>You (or someone in your team) already confirmed this as a real threat. The action stays in place; no further input needed.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Review in SOC",
        });
    }
    if (act.customer_overrode_at || act.status === "rolled_back") {
        return htmlPage({
            title: "Mithras — already reverted",
            tone: "info",
            heading: "Already reverted",
            body: `<p>This action has already been reversed. The affected endpoint is back to its prior state.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Review in SOC",
        });
    }

    // Window check.
    if (act.rollback_at && new Date(act.rollback_at as string).getTime() < Date.now()) {
        return htmlPage({
            title: "Mithras — window expired",
            tone: "info",
            heading: "Window expired",
            body: `<p>The rollback window for this action has already elapsed. If the action was reversible, it was auto-reversed when the timer fired.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open SOC",
        });
    }

    // === CONFIRM ===
    if (action === "confirm") {
        await supabase.from("ai_agent_actions").update({
            customer_confirmed_at: new Date().toISOString(),
            status: "customer_confirmed",
        }).eq("id", act.id);

        // Mirror to ai_agent_comms.confirm_clicked_at so the dashboard
        // activity feed shows the customer interaction. Best-effort —
        // missing comms row is fine.
        await supabase.from("ai_agent_comms")
            .update({ confirm_clicked_at: new Date().toISOString() })
            .eq("action_id", act.id)
            .is("confirm_clicked_at", null);

        return htmlPage({
            title: "Mithras — threat confirmed",
            tone: "ok",
            heading: "Thanks — threat confirmed",
            body: `<p>We've recorded your confirmation. The <strong>${escapeHtml(act.action_kind as string)}</strong> action stays in place and the automatic rollback has been cancelled.</p>
                   <p>If you need to release this later, you can do that from the SOC console.</p>`,
            cta_href: `${SOC_URL}/alerts`, cta_label: "Open in SOC",
        });
    }

    // === OVERRIDE / ROLLBACK ===
    const reversal = REVERSAL_KIND[act.action_kind as string];
    let rollbackCmdId: string | null = null;

    if (reversal && act.endpoint_id) {
        // Cancel any not-yet-dispatched forward command first.
        if (act.linked_command_id) {
            await supabase.from("agent_commands")
                .update({ status: "cancelled", error_message: "ai_customer_override" })
                .eq("id", act.linked_command_id)
                .in("status", ["queued","dispatched"]);
        }
        const { data: cmd } = await supabase.from("agent_commands").insert({
            endpoint_id:     act.endpoint_id,
            organization_id: act.organization_id,
            command_type:    reversal,
            params: { reason: "customer_marked_false_positive", source_action_id: act.id },
            status:          "queued",
            correlation_id:  "ai-rollback-" + act.id,
        }).select("id").single();
        rollbackCmdId = cmd?.id ?? null;
    }

    await supabase.from("ai_agent_actions").update({
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
        customer_overrode_at: new Date().toISOString(),
        rollback_command_id: rollbackCmdId,
    }).eq("id", act.id);

    // Re-acknowledge the alert as a false positive.
    if (act.alert_id) {
        await supabase.from("alerts")
            .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
            .eq("id", act.alert_id);
    }

    // Engagement mirror.
    await supabase.from("ai_agent_comms")
        .update({ override_clicked_at: new Date().toISOString() })
        .eq("action_id", act.id)
        .is("override_clicked_at", null);

    return htmlPage({
        title: "Mithras — action reverted",
        tone: "info",
        heading: "Action reverted — thanks for the feedback",
        body: `<p>We've reversed the <strong>${escapeHtml(act.action_kind as string)}</strong> on your endpoint. The machine is back to its prior state${reversal ? " — give it a minute for the agent to pick up the release." : "."}</p>
               <p>This false-positive signal helps us tune the detection for your tenant. Thanks for the feedback.</p>`,
        cta_href: `${SOC_URL}/alerts`, cta_label: "Open in SOC",
    });
});
