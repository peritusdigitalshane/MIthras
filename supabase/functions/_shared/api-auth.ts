// =============================================================================
// Bearer-token API key authentication for the public Mithras REST API.
//
// Tokens are issued by /settings/api-keys in the console; the raw token
// looks like:
//
//      mit_live_<base64url(32 random bytes)>
//
// The server only ever sees the SHA-256 hash. resolveApiKey() hashes the
// presented token, looks it up, validates expiry/revocation, and returns
// the owning org + scopes.
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ApiAuthOk {
    ok: true;
    apiKeyId:     string;
    organizationId: string;
    organizationType: string;
    scopes:       string[];
    ip:           string | null;
}
export interface ApiAuthErr {
    ok: false;
    status: number;
    error:  string;
}
export type ApiAuthResult = ApiAuthOk | ApiAuthErr;

const TOKEN_PREFIX = "mit_live_";

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function resolveApiKey(req: Request, supabase?: SupabaseClient): Promise<ApiAuthResult> {
    const client = supabase ?? createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return { ok: false, status: 401, error: "missing_bearer_token" };
    if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, status: 401, error: "invalid_token_format" };
    if (token.length < TOKEN_PREFIX.length + 32 || token.length > 256) {
        return { ok: false, status: 401, error: "invalid_token_length" };
    }

    const hash = await sha256Hex(token);
    const { data, error } = await client.rpc("api_key_resolve", { p_key_hash: hash });
    if (error || !data || !Array.isArray(data) || data.length === 0) {
        return { ok: false, status: 401, error: "invalid_token" };
    }
    const row = data[0] as {
        api_key_id: string; organization_id: string; scopes: string[];
        organization_type: string; expired: boolean; revoked: boolean;
    };
    if (row.revoked) return { ok: false, status: 401, error: "token_revoked" };
    if (row.expired) return { ok: false, status: 401, error: "token_expired" };

    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Fire-and-forget last-used update.
    (async () => {
        try { await client.rpc("api_key_touch", { p_api_key_id: row.api_key_id, p_ip: ip ?? null }); } catch {}
    })();

    return {
        ok: true,
        apiKeyId:       row.api_key_id,
        organizationId: row.organization_id,
        organizationType: row.organization_type,
        scopes:         row.scopes ?? [],
        ip,
    };
}

export function requireScope(auth: ApiAuthOk, scope: string): Response | null {
    if (auth.scopes.includes(scope) || auth.scopes.includes("*")) return null;
    return new Response(
        JSON.stringify({ error: "insufficient_scope", required: scope, granted: auth.scopes }),
        { status: 403, headers: { "content-type": "application/json" } },
    );
}

export function requireOrgType(auth: ApiAuthOk, types: string[]): Response | null {
    if (types.includes(auth.organizationType)) return null;
    return new Response(
        JSON.stringify({ error: "wrong_org_type", required: types, your_type: auth.organizationType }),
        { status: 403, headers: { "content-type": "application/json" } },
    );
}
