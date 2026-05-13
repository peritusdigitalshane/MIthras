// Phase 1: CORS allow-list helper for browser-facing edge functions.
// Agent-facing functions (agent-enroll, agent-heartbeat, agent-version-check) don't need CORS —
// they're called from a service, not a browser — but using this helper anyway costs nothing
// and forces consistent header shape.

export const ALLOWED_ORIGINS = [
    "https://appdev.peritusdigital.com.au",
    "https://apidev.peritusdigital.com.au",
    "http://appdev.peritusdigital.com.au",   // pre-HTTPS dev period
    "http://apidev.peritusdigital.com.au",
    "http://localhost:5173",                  // vite dev
    "http://localhost:8080",                  // alt dev port
];

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-agent-id, x-timestamp, x-signature";
const ALLOW_METHODS = "GET, POST, OPTIONS";

export type CorsHeaders = {
    "Access-Control-Allow-Origin"?: string;
    "Access-Control-Allow-Headers": string;
    "Access-Control-Allow-Methods": string;
    "Vary": string;
};

export function buildCorsHeaders(origin: string | null): CorsHeaders {
    const headers: CorsHeaders = {
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Vary": "Origin",
    };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
}

/**
 * If the request is an OPTIONS preflight, return a Response (204 if allowed, 403 if not).
 * Otherwise return null so the caller's main handler runs.
 */
export function handlePreflight(request: Request): Response | null {
    if (request.method !== "OPTIONS") return null;
    const origin = request.headers.get("origin");
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        return new Response(null, { status: 204, headers: buildCorsHeaders(origin) as Record<string, string> });
    }
    return new Response("CORS origin not allowed", { status: 403 });
}
