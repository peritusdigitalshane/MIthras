// POST /functions/v1/m365-shield-scan-all
//
// Operator-triggered: refresh every M365 Shield data source in parallel.
// Org admin auth required. Rate-limited via platform_locks to one scan per
// org per 2 minutes — prevents button-mash from melting the edge runtime
// or hitting upstream API rate limits.
//
// Fires (fan-out, fire-and-forget):
//   - m365-ca-poll                  (Conditional Access)
//   - m365-mfa-poll                 (MFA coverage)
//   - m365-risk-poll                (Risky sign-ins)
//   - m365-oauth-poll               (OAuth grants)
//   - m365-sharing-poll             (External sharing)
//   - m365-breach-poll              (HIBP, only if any key configured)
//   - m365-breach-poll-hudson-rock  (Hudson Rock infostealers, free)
//   - m365-breach-poll-github       (GitHub credential leaks, free)
//
// Each poller already iterates only its own shielded tenants; the manual
// scan is just "fire them all now instead of waiting for the cron tick".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Order matters for UX only — show the fastest ones first so the dashboard
// updates progressively. The actual polls run in parallel.
const POLLERS = [
    { slug: "m365-mfa-poll",                 label: "MFA Coverage" },
    { slug: "m365-risk-poll",                label: "Risky sign-ins" },
    { slug: "m365-oauth-poll",               label: "OAuth grants" },
    { slug: "m365-ca-poll",                  label: "Conditional Access" },
    { slug: "m365-sharing-poll",             label: "External sharing" },
    { slug: "m365-breach-poll-hudson-rock",  label: "Hudson Rock infostealers" },
    { slug: "m365-breach-poll-github",       label: "GitHub credential leaks" },
    { slug: "m365-breach-poll",              label: "HIBP breach lookup" },
];

const RATE_LIMIT_SECONDS = 120; // one scan per org per 2 minutes

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function authoriseUser(req: Request): Promise<{ userId: string } | null> {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt || jwt === SUPABASE_SERVICE_KEY) return null;
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return null;
    return { userId: user.id };
}

async function userIsOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper === true) return true;
    const { data: isAdmin } = await supabase.rpc("is_admin_of_org", { _user_id: userId, _org_id: orgId });
    return isAdmin === true;
}

async function getFunctionsBaseUrl(): Promise<string | null> {
    const { data } = await supabase.from("platform_settings").select("value").eq("key", "functions_base_url").maybeSingle();
    const v = data?.value;
    if (typeof v !== "string") return null;
    return v.replace(/^"|"$/g, "").replace(/\/$/, "");
}

interface PollerResult {
    slug: string;
    label: string;
    ok: boolean;
    http_status: number;
    summary?: { tenants?: number; updated?: number; tenants_ok?: number; tenants_failed?: number };
    /** First non-empty status from the inner per-tenant results, used by the UI to render banners. */
    state?: "ok" | "no_data" | "requires_premium" | "requires_consent" | "config_missing" | "graph_error" | "error";
    /** Set when state === "requires_consent" — the Graph scope that's missing. */
    missing_scope?: string;
    /** Human-readable message — the one the UI surfaces in the per-source card. */
    detail?: string;
    error?: string;
    elapsed_ms: number;
}

// Try to interpret what the inner poller actually accomplished.
// Pollers vary in shape; we look at `results[*].ok`, `requires_premium`, and
// well-known top-level error strings to classify the outcome.
function interpretInnerBody(body: any): Pick<PollerResult, "state" | "detail" | "summary"> {
    // Top-level config errors (Hudson Rock, GitHub, breach setup)
    const topErr = typeof body?.error === "string" ? body.error : null;
    if (topErr === "hudson_rock_api_key_not_configured" || topErr === "github_pat_not_configured") {
        return { state: "config_missing", detail: body?.detail ?? "Source not configured (super-admin needs to set the API key)." };
    }
    if (topErr) {
        return { state: "error", detail: topErr };
    }

    // Per-tenant results
    const innerResults: any[] = Array.isArray(body?.results) ? body.results : [];
    if (innerResults.length === 0) {
        return { state: "no_data", detail: "Nothing to poll." };
    }

    const ok      = innerResults.filter((r) => r?.ok === true).length;
    const failed  = innerResults.length - ok;
    const premium = innerResults.some((r) => r?.requires_premium === true);
    const consent = innerResults.find((r) => r?.requires_consent === true);
    const totalUpdated = innerResults.reduce((n, r) => n + (r?.users ?? r?.scored ?? r?.items ?? r?.polled ?? r?.findings ?? r?.policies_seen ?? 0), 0);

    const summary = { tenants: innerResults.length, updated: totalUpdated, tenants_ok: ok, tenants_failed: failed };

    // Consent issues take precedence over everything — fixing them unblocks
    // the actual data flow.
    if (consent) {
        return { state: "requires_consent", summary,
            detail: consent.note ?? `Tenant ${consent.tenant ?? ""} needs to reconnect — the '${consent.missing_scope ?? "required"}' Microsoft Graph permission is missing.`,
            missing_scope: consent.missing_scope } as any;
    }
    if (ok > 0 && totalUpdated === 0 && premium) {
        return { state: "requires_premium", summary,
            detail: innerResults.find((r) => r?.note)?.note ?? "Microsoft requires Entra ID P1 for this data source." };
    }
    if (ok === 0 && premium) {
        return { state: "requires_premium", summary,
            detail: innerResults.find((r) => r?.note)?.note ?? "Microsoft requires Entra ID P1 for this data source." };
    }
    if (ok === 0 && failed > 0) {
        const firstErr = innerResults.find((r) => r?.error)?.error ?? "All tenants failed.";
        return { state: "graph_error", summary, detail: String(firstErr).slice(0, 200) };
    }
    if (ok > 0 && totalUpdated === 0) {
        return { state: "no_data", summary, detail: "Polled successfully — no new records." };
    }
    return { state: "ok", summary, detail: `${totalUpdated} record${totalUpdated === 1 ? "" : "s"} refreshed across ${ok} tenant${ok === 1 ? "" : "s"}.` };
}

async function firePoller(baseUrl: string, slug: string, label: string): Promise<PollerResult> {
    const t0 = Date.now();
    try {
        const r = await fetch(`${baseUrl}/${slug}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-cron-secret": CRON_SECRET,
            },
            body: "{}",
            signal: AbortSignal.timeout(60_000),
        });
        const elapsed_ms = Date.now() - t0;
        let body: any = null;
        try { body = await r.json(); } catch { /* response wasn't JSON */ }

        if (!r.ok) {
            const interp = body ? interpretInnerBody(body) : { state: "error" as const, detail: `http_${r.status}` };
            return {
                slug, label,
                ok: interp.state === "ok",      // never ok on non-2xx — but config_missing still surfaces clean
                http_status: r.status,
                state: interp.state,
                detail: interp.detail,
                summary: interp.summary,
                error: interp.state === "config_missing" ? undefined : (interp.detail ?? `http_${r.status}`),
                elapsed_ms,
            };
        }

        const interp = body ? interpretInnerBody(body) : { state: "ok" as const };
        const ok = interp.state === "ok" || interp.state === "no_data" || interp.state === "requires_premium";
        return {
            slug, label,
            // "ok" in the operator sense: the poll did its job, even if there's nothing to show.
            // requires_consent is NOT ok — the operator needs to take action.
            ok,
            http_status: r.status,
            state: interp.state,
            detail: interp.detail,
            summary: interp.summary,
            missing_scope: (interp as any).missing_scope,
            elapsed_ms,
        };
    } catch (e) {
        return {
            slug, label, ok: false, http_status: 0,
            state: "error",
            error: String((e as Error).message ?? e).slice(0, 200),
            detail: String((e as Error).message ?? e).slice(0, 200),
            elapsed_ms: Date.now() - t0,
        };
    }
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: { organization_id?: string };
    try { body = await req.json(); } catch { body = {}; }
    if (!body.organization_id) return json({ error: "organization_id_required" }, 400, origin);

    if (!(await userIsOrgAdmin(caller.userId, body.organization_id))) {
        return json({ error: "forbidden" }, 403, origin);
    }

    // Confirm shield is enabled
    const { data: org } = await supabase
        .from("organizations")
        .select("id, m365_shield_enabled")
        .eq("id", body.organization_id).maybeSingle();
    if (!org) return json({ error: "organization_not_found" }, 404, origin);
    if (!org.m365_shield_enabled) return json({ error: "m365_shield_not_enabled" }, 409, origin);

    // Rate limit: try to acquire a per-org mutex with 120s TTL. If another
    // scan started within that window, refuse.
    const lockName = `shield_scan_${body.organization_id}`;
    const { data: acquired, error: lockErr } = await supabase.rpc("try_acquire_platform_lock", {
        _name: lockName,
        _holder: caller.userId,
        _ttl_seconds: RATE_LIMIT_SECONDS,
    });
    if (lockErr) return json({ error: "lock_error", detail: lockErr.message }, 500, origin);
    if (acquired === false) {
        return json({
            error: "rate_limited",
            detail: `A scan is already running or completed recently. Wait ${RATE_LIMIT_SECONDS}s between scans.`,
        }, 429, origin);
    }

    const baseUrl = await getFunctionsBaseUrl();
    if (!baseUrl) return json({ error: "functions_base_url_missing" }, 500, origin);

    // Fan out in parallel. allSettled means a single poller crashing doesn't
    // affect the others.
    const results = await Promise.all(
        POLLERS.map((p) => firePoller(baseUrl, p.slug, p.label)),
    );

    // Log activity
    const summary = {
        total: results.length,
        ok: results.filter((r) => r.state === "ok").length,
        no_data: results.filter((r) => r.state === "no_data").length,
        requires_premium: results.filter((r) => r.state === "requires_premium").length,
        requires_consent: results.filter((r) => r.state === "requires_consent").length,
        config_missing: results.filter((r) => r.state === "config_missing").length,
        failed: results.filter((r) => r.state === "graph_error" || r.state === "error").length,
    };
    await supabase.from("activity_logs").insert({
        organization_id: body.organization_id,
        user_id: caller.userId,
        action: "m365_shield_manual_scan",
        resource_type: "m365_shield",
        details: { summary, results: results.map((r) => ({
            slug: r.slug, state: r.state, detail: r.detail, http_status: r.http_status, elapsed_ms: r.elapsed_ms,
        })) },
    });

    return json({ ok: true, summary, results }, 200, origin);
});
