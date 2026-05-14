// Phase 1: HMAC-SHA256 request signing for agent ↔ platform calls.
// Both runtimes (PowerShell, .NET) implement the same canonicalization rules.
//
// Signing input:  "<METHOD>\n<path>\n<unix_ts>\n<canonical_body>"
// Signature:      hex-encoded HMAC-SHA256 of the above keyed by agent_secret
// Headers on the wire: X-Agent-Id, X-Timestamp, X-Signature
//
// Replay window: ±300 seconds.

export const TIMESTAMP_SKEW_SECONDS = 300;

export type HmacRequest = {
    method: string;
    path: string;
    timestamp: string;
    agentId: string;
    signature: string;
    rawBody: string;
};

export type VerifyResult =
    | { ok: true; reason?: undefined }
    | { ok: false; reason: "timestamp_invalid" | "timestamp_skew" | "signature_mismatch" };

/**
 * Canonical JSON: sorted keys at every object level, no whitespace, arrays preserve order.
 * Both runtimes must produce the same canonical string for the same input.
 */
export function canonicalizeJson(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return Number.isFinite(value) ? value.toString() : "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalizeJson).join(",") + "]";
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalizeJson(obj[k])).join(",") + "}";
    }
    return "null";
}

/**
 * Compute HMAC-SHA256 signature, returned as lowercase hex.
 * rawBody is used verbatim — caller is responsible for canonicalizing if needed.
 */
export async function computeSignature(
    secret: string,
    method: string,
    path: string,
    timestamp: string,
    rawBody: string,
): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const message = `${method.toUpperCase()}\n${path}\n${timestamp}\n${rawBody}`;
    const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    return Array.from(sigBytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time hex comparison.
 */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

export async function verifyHmacRequest(req: HmacRequest, secret: string): Promise<VerifyResult> {
    const tsNum = Number(req.timestamp);
    if (!Number.isFinite(tsNum) || tsNum <= 0) {
        return { ok: false, reason: "timestamp_invalid" };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > TIMESTAMP_SKEW_SECONDS) {
        return { ok: false, reason: "timestamp_skew" };
    }
    const expected = await computeSignature(secret, req.method, req.path, req.timestamp, req.rawBody);
    if (!constantTimeEqual(expected, req.signature.toLowerCase())) {
        return { ok: false, reason: "signature_mismatch" };
    }
    return { ok: true };
}

/**
 * Helper to extract HMAC fields from a Request. Returns null if any header missing.
 */
export async function extractHmacRequest(request: Request): Promise<HmacRequest | null> {
    const agentId = request.headers.get("x-agent-id");
    const timestamp = request.headers.get("x-timestamp");
    const signature = request.headers.get("x-signature");
    if (!agentId || !timestamp || !signature) return null;
    const url = new URL(request.url);
    const rawBody = request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.text();
    return {
        method: request.method,
        path: url.pathname,
        timestamp,
        agentId,
        signature,
        rawBody,
    };
}
