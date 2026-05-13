import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
    canonicalizeJson,
    computeSignature,
    verifyHmacRequest,
    type HmacRequest,
} from "./hmac.ts";

Deno.test("canonicalizeJson sorts keys recursively", () => {
    const input = { b: 2, a: { d: 4, c: 3 }, e: [3, 1, 2] };
    const expected = '{"a":{"c":3,"d":4},"b":2,"e":[3,1,2]}';
    assertEquals(canonicalizeJson(input), expected);
});

Deno.test("canonicalizeJson preserves array order", () => {
    assertEquals(canonicalizeJson([3, 1, 2]), "[3,1,2]");
});

Deno.test("canonicalizeJson handles null, true, false, numbers, strings", () => {
    assertEquals(canonicalizeJson({ a: null, b: true, c: 1.5, d: "x" }), '{"a":null,"b":true,"c":1.5,"d":"x"}');
});

Deno.test("computeSignature produces stable HMAC-SHA256 hex", async () => {
    const secret = "test-secret-key";
    const sig = await computeSignature(secret, "POST", "/foo", "1700000000", '{"a":1}');
    assertEquals(sig.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(sig), true);
    const sig2 = await computeSignature(secret, "POST", "/foo", "1700000000", '{"a":1}');
    assertEquals(sig, sig2);
});

Deno.test("computeSignature differs when any field differs", async () => {
    const s = "secret";
    const base = await computeSignature(s, "POST", "/foo", "1700000000", '{"a":1}');
    const diffMethod = await computeSignature(s, "GET", "/foo", "1700000000", '{"a":1}');
    const diffPath = await computeSignature(s, "POST", "/bar", "1700000000", '{"a":1}');
    const diffTs = await computeSignature(s, "POST", "/foo", "1700000001", '{"a":1}');
    const diffBody = await computeSignature(s, "POST", "/foo", "1700000000", '{"a":2}');
    assertEquals(new Set([base, diffMethod, diffPath, diffTs, diffBody]).size, 5);
});

Deno.test("verifyHmacRequest accepts valid signed request", async () => {
    const secret = "test-secret-key";
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = '{"hello":"world"}';
    const sig = await computeSignature(secret, "POST", "/x", ts, body);
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: ts,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: body,
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, true);
});

Deno.test("verifyHmacRequest rejects bad signature", async () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: ts,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: "0".repeat(64),
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, "secret");
    assertEquals(result.ok, false);
    assertEquals(result.reason, "signature_mismatch");
});

Deno.test("verifyHmacRequest rejects stale timestamp (>5min old)", async () => {
    const secret = "secret";
    const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
    const sig = await computeSignature(secret, "POST", "/x", oldTs, "{}");
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: oldTs,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_skew");
});

Deno.test("verifyHmacRequest rejects future timestamp (>5min ahead)", async () => {
    const secret = "secret";
    const futureTs = (Math.floor(Date.now() / 1000) + 400).toString();
    const sig = await computeSignature(secret, "POST", "/x", futureTs, "{}");
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: futureTs,
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: sig,
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, secret);
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_skew");
});

Deno.test("verifyHmacRequest rejects malformed timestamp", async () => {
    const req: HmacRequest = {
        method: "POST",
        path: "/x",
        timestamp: "not-a-number",
        agentId: "00000000-0000-0000-0000-000000000001",
        signature: "0".repeat(64),
        rawBody: "{}",
    };
    const result = await verifyHmacRequest(req, "secret");
    assertEquals(result.ok, false);
    assertEquals(result.reason, "timestamp_invalid");
});
