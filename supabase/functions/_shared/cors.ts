// Phase 1: CORS allow-list helper for browser-facing edge functions.
// Agent-facing functions (agent-enroll, agent-heartbeat, agent-version-check) don't need CORS —
// they're called from a service, not a browser — but using this helper anyway costs nothing
// and forces consistent header shape.

export const ALLOWED_ORIGINS = [
    // Production
    "https://www.mithras.com.au",
    "https://mithras.com.au",
    "https://app.mithras.com.au",            // reserved; not in DNS yet but harmless
    // Dev / staging — HTTPS only. Plain-HTTP entries were dropped because
    // we now ship credentialled CORS, and a credentialled cookie over HTTP
    // is interceptable. Use https://appdev locally; for vite dev use
    // localhost which browsers treat as a secure context even over HTTP.
    "https://appdev.peritusdigital.com.au",
    "https://apidev.peritusdigital.com.au",
    "http://localhost:5173",                  // vite dev (secure-context exception)
    "http://localhost:8080",                  // alt dev port (secure-context exception)
];

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-agent-id, x-timestamp, x-signature";
const ALLOW_METHODS = "GET, POST, OPTIONS";

export type CorsHeaders = {
    "Access-Control-Allow-Origin"?: string;
    "Access-Control-Allow-Headers": string;
    "Access-Control-Allow-Methods": string;
    "Access-Control-Allow-Credentials"?: string;
    "Vary": string;
};

/**
 * True if the origin is safe to receive a credentialled CORS response —
 * either HTTPS, or one of the localhost loopback origins (which browsers
 * treat as a secure context even over plain HTTP).
 */
function isSecureContextOrigin(origin: string): boolean {
    if (origin.startsWith("https://")) return true;
    // Loopback exception — per W3C secure-contexts spec, http://localhost
    // and http://127.0.0.1 are trusted because the traffic never leaves
    // the box. Limit to the exact dev ports we allow.
    if (origin === "http://localhost:5173" || origin === "http://localhost:8080") return true;
    return false;
}

export function buildCorsHeaders(origin: string | null): CorsHeaders {
    const headers: CorsHeaders = {
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Vary": "Origin",
    };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        // Cookie-bearing flows (soc-bridge) need credentialled CORS so the
        // browser will both send cookies on the request and accept Set-Cookie
        // from the response. ONLY emit this for secure-context origins —
        // sending a session cookie over plain HTTP is interceptable.
        if (isSecureContextOrigin(origin)) {
            headers["Access-Control-Allow-Credentials"] = "true";
        }
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
