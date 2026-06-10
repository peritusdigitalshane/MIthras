// MIME / SMTP header-injection defenses.
//
// Anything that's interpolated into a header line (Subject, To, From,
// Content-Disposition filename...) MUST be stripped of CR/LF, or an
// attacker who controls the upstream value can inject arbitrary headers
// — Bcc: to a third party, Reply-To: a phishing inbox, or worse, a SMTP
// envelope-level injection by closing the RCPT TO: line.
//
// Same risk applies to the recipient string we pass to RCPT TO: itself.
// Validate strictly — anything that fails the email regex below is
// dropped, never sent.

/**
 * Strip every whitespace control sequence (CR/LF/TAB/etc.) from a header
 * value and collapse runs of whitespace into a single space. Use on every
 * dynamic string that lands in a header line.
 */
export function sanitizeHeader(value: string | null | undefined): string {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Strict email validation. Rejects values containing CR / LF / NUL / angle
 * brackets / whitespace and anything that doesn't look like a single,
 * RFC-5321-ish addr-spec. This is intentionally narrower than what's
 * technically legal — Mithras only ever needs to send to plain mailboxes.
 */
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,63}$/;

export function isValidEmail(value: string | null | undefined): boolean {
    if (value === null || value === undefined) return false;
    const s = String(value);
    // Length cap matches typical SMTP server limits (RFC 5321 § 4.5.3.1.3).
    if (s.length > 254) return false;
    if (/[\r\n <>\s]/.test(s)) return false;
    return EMAIL_RE.test(s);
}

/**
 * RFC 2047 encoded-word for non-ASCII header values. Most ASCII text
 * passes through unchanged; non-ASCII gets B-encoded so the receiving
 * MTA doesn't trip over high bytes.
 */
export function encodeHeader(value: string): string {
    const clean = sanitizeHeader(value);
    if (clean.length === 0) return clean;
    // Plain 7-bit ASCII (no control chars beyond TAB) — pass through.
    if (/^[\x20-\x7E]*$/.test(clean)) return clean;
    const utf8 = new TextEncoder().encode(clean);
    let bin = "";
    for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
    return `=?utf-8?B?${btoa(bin)}?=`;
}

/**
 * HTML-escape a value so it can't escape its <strong> / <p> wrapper into
 * arbitrary markup. Use everywhere an untrusted string lands inside an
 * HTML mail body.
 */
export function escapeHtml(value: string | null | undefined): string {
    const s = value === null || value === undefined ? "" : String(value);
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}
