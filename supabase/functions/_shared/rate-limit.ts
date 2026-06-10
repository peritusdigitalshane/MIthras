// Per-IP rate limiter for edge functions.
//
// In-memory sliding window. Stays within a single isolate so it's
// best-effort (different isolates can see different counters), but for
// the actual threats here — single-IP brute force, runaway bots, broken
// clients — it's plenty. For platform-wide rate limits across all
// isolates you'd need Redis or Postgres, which we'll add when we have
// real customer traffic to size against.

interface Bucket {
    count: number;
    windowStartMs: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

// Rough housekeeping: when the map grows past MAX_KEYS, drop the oldest
// half. O(n) but only fires under attack.
function maybeEvict(): void {
    if (buckets.size <= MAX_KEYS) return;
    const entries = Array.from(buckets.entries()).sort(
        (a, b) => a[1].windowStartMs - b[1].windowStartMs,
    );
    for (let i = 0; i < entries.length / 2; i++) buckets.delete(entries[i][0]);
}

export interface RateLimitOptions {
    windowMs?: number;      // default 60_000 (1 minute)
    max?: number;           // default 60
    bucketKey?: string;     // override the auto-derived key (e.g. include user id)
}

export interface RateLimitVerdict {
    ok: boolean;
    remaining: number;
    retryAfterSec: number;
}

/**
 * Returns a 429 response if the IP exceeded its budget, otherwise null and
 * the caller continues. Pass the request and the function name. The function
 * name keeps the budget per-endpoint (so a chatty /heartbeat doesn't burn
 * the /reset-password budget).
 */
export function checkRateLimit(req: Request, fnName: string, opts: RateLimitOptions = {}): RateLimitVerdict {
    const windowMs = opts.windowMs ?? 60_000;
    const max = opts.max ?? 60;

    const ip = clientIp(req);
    const key = opts.bucketKey ?? `${fnName}:${ip}`;
    const now = Date.now();

    let b = buckets.get(key);
    if (!b || now - b.windowStartMs >= windowMs) {
        b = { count: 0, windowStartMs: now };
        buckets.set(key, b);
        maybeEvict();
    }
    b.count++;

    if (b.count > max) {
        return {
            ok: false,
            remaining: 0,
            retryAfterSec: Math.ceil((b.windowStartMs + windowMs - now) / 1000),
        };
    }
    return {
        ok: true,
        remaining: Math.max(0, max - b.count),
        retryAfterSec: 0,
    };
}

function clientIp(req: Request): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
    // Last-resort: hash a few stable-ish headers so we still cluster by
    // probable client even without proxy-injected IP headers.
    const ua = req.headers.get("user-agent") ?? "";
    return `noip:${hash32(ua)}`;
}

function hash32(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
}

/**
 * Convenience: build a 429 Response matching the verdict.
 */
export function rateLimitResponse(verdict: RateLimitVerdict, corsHeaders: Record<string, string>): Response {
    return new Response(
        JSON.stringify({ error: "rate_limited", retry_after_seconds: verdict.retryAfterSec }),
        {
            status: 429,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": String(verdict.retryAfterSec),
            },
        },
    );
}
