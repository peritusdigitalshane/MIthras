// POST /functions/v1/m365-breach-setup
// Body: { tenant_pk, domain, hibp_api_key, action: 'save' | 'remove' | 'test' }
//
// Operator-triggered. Saves / tests / removes the HIBP API key for a
// (tenant, domain) subscription. Validates the key by hitting HIBP's
// /api/v3/breacheddomain/{domain} endpoint — this also implicitly verifies
// domain ownership (HIBP returns 403 if the key isn't subscribed to that
// domain's monitoring).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const HIBP_BASE = "https://haveibeenpwned.com/api/v3";
const USER_AGENT = "Mithras-DarkWebMonitor/1.0";

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

// Verify the HIBP API key + domain ownership in one call.
async function verifyHibpKey(domain: string, apiKey: string): Promise<{ ok: true } | { ok: false; status: string; detail: string }> {
    try {
        const r = await fetch(`${HIBP_BASE}/breacheddomain/${encodeURIComponent(domain)}`, {
            headers: { "hibp-api-key": apiKey, "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) return { ok: true };
        if (r.status === 401) return { ok: false, status: "invalid_key", detail: "HIBP API key rejected — copy-paste again from haveibeenpwned.com/Account" };
        if (r.status === 403) return { ok: false, status: "unverified_domain", detail: `${domain} isn't verified on this HIBP account. Go to haveibeenpwned.com/DomainSearch and add the TXT record or email confirmation.` };
        if (r.status === 404) return { ok: false, status: "unverified_domain", detail: `HIBP doesn't recognise ${domain} as a monitored domain on this key.` };
        if (r.status === 429) return { ok: false, status: "rate_limited", detail: "HIBP rate limit — try again in a minute." };
        return { ok: false, status: `http_${r.status}`, detail: (await r.text()).slice(0, 200) };
    } catch (e) {
        return { ok: false, status: "fetch_failed", detail: String((e as Error).message ?? e).slice(0, 200) };
    }
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    const caller = await authoriseUser(req);
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    let body: { tenant_pk?: string; domain?: string; hibp_api_key?: string; action?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
    if (!body.tenant_pk) return json({ error: "tenant_pk_required" }, 400, origin);
    if (!body.domain) return json({ error: "domain_required" }, 400, origin);

    // Authorise per-org via tenant lookup
    const { data: t } = await supabase
        .from("m365_tenants")
        .select("id, organization_id")
        .eq("id", body.tenant_pk).maybeSingle();
    if (!t) return json({ error: "tenant_not_found" }, 404, origin);
    if (!(await userIsOrgAdmin(caller.userId, t.organization_id))) return json({ error: "forbidden" }, 403, origin);

    const domain = body.domain.toLowerCase().trim();
    const action = body.action ?? "save";

    if (action === "remove") {
        await supabase
            .from("m365_breach_monitoring")
            .update({
                hibp_api_key: null,
                verified_at: null,
                verified_by: null,
                last_poll_status: null,
                last_poll_error: null,
                updated_at: new Date().toISOString(),
            })
            .eq("m365_tenant_id", body.tenant_pk)
            .eq("domain", domain);
        await supabase.from("activity_logs").insert({
            organization_id: t.organization_id,
            user_id: caller.userId,
            action: "breach_monitor_key_removed",
            resource_type: "m365_breach_monitoring",
            resource_id: domain,
        });
        return json({ ok: true, action: "removed" }, 200, origin);
    }

    if (!body.hibp_api_key) return json({ error: "hibp_api_key_required" }, 400, origin);

    // Validate the key + domain
    const verify = await verifyHibpKey(domain, body.hibp_api_key);
    if (!verify.ok) {
        return json({ error: verify.status, detail: verify.detail }, 400, origin);
    }

    if (action === "test") {
        return json({ ok: true, action: "tested" }, 200, origin);
    }

    // Save
    const now = new Date().toISOString();
    const { error: upsertErr } = await supabase
        .from("m365_breach_monitoring")
        .upsert({
            organization_id: t.organization_id,
            m365_tenant_id:  body.tenant_pk,
            domain,
            hibp_api_key:    body.hibp_api_key,
            verified_at:     now,
            verified_by:     caller.userId,
            is_enabled:      true,
            updated_at:      now,
        }, { onConflict: "m365_tenant_id,domain" });

    if (upsertErr) return json({ error: "save_failed", detail: upsertErr.message }, 500, origin);

    await supabase.from("activity_logs").insert({
        organization_id: t.organization_id,
        user_id: caller.userId,
        action: "breach_monitor_configured",
        resource_type: "m365_breach_monitoring",
        resource_id: domain,
        metadata: { domain },
    });

    return json({ ok: true, action: "saved", domain }, 200, origin);
});
