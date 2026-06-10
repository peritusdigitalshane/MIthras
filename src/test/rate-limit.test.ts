// Unit tests for the per-IP rate-limit helper used by the user-facing edge
// functions (admin-reset-password, soc-bridge, smtp-settings, send-customer-report).

import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../../supabase/functions/_shared/rate-limit";

function reqFor(ip: string): Request {
  return new Request("https://example.com/x", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const ip = "1.2.3." + Math.floor(Math.random() * 254 + 1); // unique bucket
    for (let i = 0; i < 5; i++) {
      const v = checkRateLimit(reqFor(ip), "test-under", { max: 10, windowMs: 60_000 });
      expect(v.ok).toBe(true);
    }
  });

  it("denies once the limit is exceeded", () => {
    const ip = "9.9.9.1";
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(reqFor(ip), "test-deny", { max: 3, windowMs: 60_000 }).ok).toBe(true);
    }
    expect(checkRateLimit(reqFor(ip), "test-deny", { max: 3, windowMs: 60_000 }).ok).toBe(false);
  });

  it("returns a sensible retry-after when denied", () => {
    const ip = "9.9.9.2";
    for (let i = 0; i < 2; i++) checkRateLimit(reqFor(ip), "test-retry", { max: 2, windowMs: 60_000 });
    const v = checkRateLimit(reqFor(ip), "test-retry", { max: 2, windowMs: 60_000 });
    expect(v.ok).toBe(false);
    expect(v.retryAfterSec).toBeGreaterThan(0);
    expect(v.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("scopes the budget per function name", () => {
    // Hitting endpoint A doesn't burn endpoint B's budget for the same IP.
    const ip = "9.9.9.3";
    for (let i = 0; i < 3; i++) {
      checkRateLimit(reqFor(ip), "endpoint-A", { max: 3, windowMs: 60_000 });
    }
    expect(checkRateLimit(reqFor(ip), "endpoint-A", { max: 3, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit(reqFor(ip), "endpoint-B", { max: 3, windowMs: 60_000 }).ok).toBe(true);
  });

  it("scopes per IP", () => {
    // Different IPs don't share buckets.
    const ipA = "9.9.9.10";
    const ipB = "9.9.9.11";
    for (let i = 0; i < 3; i++) {
      checkRateLimit(reqFor(ipA), "test-per-ip", { max: 3, windowMs: 60_000 });
    }
    expect(checkRateLimit(reqFor(ipA), "test-per-ip", { max: 3, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit(reqFor(ipB), "test-per-ip", { max: 3, windowMs: 60_000 }).ok).toBe(true);
  });

  it("treats the first XFF entry as the client IP", () => {
    const req = new Request("https://example.com/x", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    const v = checkRateLimit(req, "test-xff", { max: 5, windowMs: 60_000 });
    expect(v.ok).toBe(true);
    // burn the budget for that IP via XFF only
    for (let i = 0; i < 4; i++) {
      checkRateLimit(req, "test-xff", { max: 5, windowMs: 60_000 });
    }
    expect(checkRateLimit(req, "test-xff", { max: 5, windowMs: 60_000 }).ok).toBe(false);
  });

  it("falls back to a stable bucket when no IP header is present", () => {
    const req = new Request("https://example.com/x", {
      method: "POST",
      headers: { "user-agent": "stable-ua" },
    });
    // Same UA produces the same bucket → eventually limits.
    for (let i = 0; i < 4; i++) {
      checkRateLimit(req, "test-noip", { max: 4, windowMs: 60_000 });
    }
    expect(checkRateLimit(req, "test-noip", { max: 4, windowMs: 60_000 }).ok).toBe(false);
  });
});
