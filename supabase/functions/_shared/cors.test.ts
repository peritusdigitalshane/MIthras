import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCorsHeaders, handlePreflight, ALLOWED_ORIGINS } from "./cors.ts";

Deno.test("ALLOWED_ORIGINS includes appdev and apidev over HTTPS", () => {
    assertEquals(ALLOWED_ORIGINS.includes("https://appdev.peritusdigital.com.au"), true);
    assertEquals(ALLOWED_ORIGINS.includes("https://apidev.peritusdigital.com.au"), true);
});

Deno.test("ALLOWED_ORIGINS excludes plain-HTTP dev origins", () => {
    // This assertion used to be inverted -- it required
    // http://appdev.peritusdigital.com.au to be allowed. The plain-HTTP
    // entries were deliberately dropped from cors.ts when credentialled CORS
    // shipped, because a session cookie sent over HTTP is interceptable. The
    // test was never updated because nothing in the repo ran the Deno suite
    // (vitest's include glob is "src/**" only). It now asserts the secure
    // behaviour rather than the old insecure one.
    assertEquals(ALLOWED_ORIGINS.includes("http://appdev.peritusdigital.com.au"), false);
    assertEquals(ALLOWED_ORIGINS.includes("http://apidev.peritusdigital.com.au"), false);
});

Deno.test("localhost dev origins remain allowed (secure-context exception)", () => {
    assertEquals(ALLOWED_ORIGINS.includes("http://localhost:5173"), true);
    assertEquals(ALLOWED_ORIGINS.includes("http://localhost:8080"), true);
});

Deno.test("buildCorsHeaders returns origin when allowed", () => {
    const headers = buildCorsHeaders("https://appdev.peritusdigital.com.au");
    assertEquals(headers["Access-Control-Allow-Origin"], "https://appdev.peritusdigital.com.au");
    assertEquals(headers["Access-Control-Allow-Headers"].includes("authorization"), true);
    assertEquals(headers["Vary"], "Origin");
});

Deno.test("buildCorsHeaders omits origin when not allowed", () => {
    const headers = buildCorsHeaders("https://evil.example.com");
    assertEquals(headers["Access-Control-Allow-Origin"], undefined as unknown as string);
});

Deno.test("buildCorsHeaders handles null origin (non-browser caller)", () => {
    const headers = buildCorsHeaders(null);
    assertEquals(headers["Access-Control-Allow-Origin"], undefined as unknown as string);
});

Deno.test("handlePreflight returns 204 with CORS headers for OPTIONS from allowed origin", () => {
    const req = new Request("https://example/x", {
        method: "OPTIONS",
        headers: { origin: "https://appdev.peritusdigital.com.au" },
    });
    const resp = handlePreflight(req);
    assertEquals(resp?.status, 204);
    assertEquals(resp?.headers.get("Access-Control-Allow-Origin"), "https://appdev.peritusdigital.com.au");
});

Deno.test("handlePreflight returns null for non-OPTIONS requests", () => {
    const req = new Request("https://example/x", { method: "POST" });
    assertEquals(handlePreflight(req), null);
});

Deno.test("handlePreflight returns 403 for OPTIONS from disallowed origin", () => {
    const req = new Request("https://example/x", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
    });
    const resp = handlePreflight(req);
    assertEquals(resp?.status, 403);
});
