// POST /functions/v1/pwned-passwords-check
// Body: { password: string }    (NOT stored, never logged)
//
// K-anonymity check against api.pwnedpasswords.com — completely free, no
// API key, unlimited use, no auth required by HIBP. The full password never
// leaves this function. We SHA-1 it locally, send the first 5 hex chars to
// HIBP, get back a list of suffixes + counts, and check if our suffix is in
// the list.
//
// Returns: { pwned: boolean, count: number }
//   count = how many times this password has been seen in breaches
//
// Use case: gate operator-assisted password reset — refuse to set a new
// password that's been seen 0+ times in known breaches.

import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function sha1Hex(input: string): Promise<string> {
    const enc = new TextEncoder().encode(input);
    const hashBuf = await crypto.subtle.digest("SHA-1", enc);
    return Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    // Require a session — this isn't public, but ANY authenticated user can
    // use it. No org or admin check needed; we're just hashing.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401, origin);

    let body: { password?: string };
    try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400, origin); }
    if (!body.password || typeof body.password !== "string") {
        return json({ error: "password_required" }, 400, origin);
    }
    // Hard ceiling — anyone sending a 100KB password is doing something wrong.
    if (body.password.length > 1024) return json({ error: "password_too_long" }, 400, origin);

    const hash = await sha1Hex(body.password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    try {
        const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: {
                "User-Agent": "Mithras-PasswordCheck/1.0",
                // Pad the response to obscure exact size of the match list — HIBP supports this.
                "Add-Padding": "true",
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) {
            return json({ error: "hibp_unavailable", status: r.status }, 502, origin);
        }
        const text = await r.text();
        let count = 0;
        for (const line of text.split("\n")) {
            const colonIdx = line.indexOf(":");
            if (colonIdx <= 0) continue;
            const candidateSuffix = line.slice(0, colonIdx).trim().toUpperCase();
            if (candidateSuffix === suffix) {
                count = parseInt(line.slice(colonIdx + 1).trim(), 10) || 0;
                break;
            }
        }
        return json({ pwned: count > 0, count }, 200, origin);
    } catch (e) {
        return json({ error: "fetch_failed", detail: String((e as Error).message ?? e).slice(0, 200) }, 502, origin);
    }
});
