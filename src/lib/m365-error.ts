// Shared classifier for `m365_tenants.last_poll_error`.
//
// The signins + directoryAudits Graph endpoints return 403
// RequestFromNonPremiumTenantOrB2CTenant on tenants without Entra ID P1 —
// that's a licensing gap on the customer's M365 SKU, not a Mithras
// failure. Both M365 surfaces (the Identity connect page and the M365
// posture page) used to render the raw error string as a red alert.
// Splitting the error into "license-blocked sections" vs "real errors"
// lets each surface render them differently.

export interface ParsedPollError {
    /** Human labels for sections blocked by the tenant's M365 SKU. */
    licenseBlocked: string[];
    /** Anything else in the error string. Null when there are no other errors. */
    other: string | null;
}

// Tolerant stem — Graph's full code is `Authentication_RequestFromNonPremiumTenantOrB2CTenant`
// but upstream truncators sometimes clip mid-word. Matching on `RequestFromNonPremi` catches
// the full code and the most common truncations.
const PREMIUM_LICENSE_RE = /RequestFromNonPremi/i;

const SECTION_LABELS: Record<string, string> = {
    signins: "Sign-in monitoring",
    audit:   "Admin activity audit",
};

export function parsePollError(raw: string | null | undefined): ParsedPollError {
    if (!raw) return { licenseBlocked: [], other: null };
    const blocked: string[] = [];
    const others: string[] = [];
    for (const part of raw.split(/;\s*/)) {
        if (!part) continue;
        if (PREMIUM_LICENSE_RE.test(part)) {
            const m = part.match(/^([a-z_]+):/i);
            const section = m?.[1];
            const label = (section && SECTION_LABELS[section]) ?? section ?? "Premium feature";
            if (!blocked.includes(label)) blocked.push(label);
        } else {
            others.push(part);
        }
    }
    return { licenseBlocked: blocked, other: others.length ? others.join("; ") : null };
}
