// Boot-time analytics shim.
//
// What this does:
//   1. Reads cached config from localStorage (zero-delay GTM inject on
//      repeat visits).
//   2. Inject the GTM script + iframe noscript fallback if a container ID
//      is set.
//   3. Fetch the live config from /functions/v1/public-config in the
//      background. If it changed, update the cache. The next page load
//      picks up the new ID.
//
// Why not just always fetch first: the fetch costs 50-200ms on cold load
// and GTM needs to fire before the user's first interaction for accurate
// conversion attribution. Cached + revalidate gives instant inject for
// repeat visitors.

interface AnalyticsConfig {
    gtm_id: string;
    track_logged_in: boolean;
    consent_mode: boolean;
}

const STORAGE_KEY = "mithras.analytics.v1";
const FETCH_TIMEOUT_MS = 4_000;

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");

let _config: AnalyticsConfig = { gtm_id: "", track_logged_in: false, consent_mode: false };
let _gtmInjected = false;

function readCachedConfig(): AnalyticsConfig | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.gtm_id !== "string") return null;
        return {
            gtm_id:          parsed.gtm_id,
            track_logged_in: !!parsed.track_logged_in,
            consent_mode:    !!parsed.consent_mode,
        };
    } catch {
        return null;
    }
}

function writeCachedConfig(cfg: AnalyticsConfig): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

function injectGtm(containerId: string, consentMode: boolean): void {
    if (_gtmInjected) return;
    if (!/^GTM-[A-Z0-9]+$/i.test(containerId)) return;  // defensive ID-shape guard
    _gtmInjected = true;

    // Initialise dataLayer + consent default before GTM loads.
    (window as any).dataLayer = (window as any).dataLayer || [];
    if (consentMode) {
        // Consent Mode v2: deny everything by default. A future cookie
        // banner can push `consent update` with grants when the user
        // accepts.
        (window as any).dataLayer.push({
            "consent": "default",
            "ad_storage":             "denied",
            "ad_user_data":           "denied",
            "ad_personalization":     "denied",
            "analytics_storage":      "denied",
            "functionality_storage":  "denied",
            "personalization_storage": "denied",
            "security_storage":       "granted",
            "wait_for_update":        500,
        });
    }
    (window as any).dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

    // Standard GTM container snippet (script element).
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    document.head.appendChild(script);

    // <noscript> fallback for browsers with JS disabled (still useful for
    // basic pageview counting via the iframe).
    const noscript = document.createElement("noscript");
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`;
    iframe.height = "0";
    iframe.width = "0";
    iframe.style.display = "none";
    iframe.style.visibility = "hidden";
    noscript.appendChild(iframe);
    document.body.insertBefore(noscript, document.body.firstChild);
}

async function fetchLiveConfig(): Promise<AnalyticsConfig | null> {
    if (!SUPABASE_URL) return null;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/public-config`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!resp.ok) return null;
        const body = await resp.json();
        const a = body?.analytics ?? {};
        return {
            gtm_id:          typeof a.gtm_id === "string" ? a.gtm_id : "",
            track_logged_in: !!a.track_logged_in,
            consent_mode:    !!a.consent_mode,
        };
    } catch {
        return null;
    }
}

/**
 * Call once at app boot, before React mounts. Synchronously injects GTM
 * from cached config (if any) and kicks off the background revalidate.
 */
export function bootAnalytics(): void {
    const cached = readCachedConfig();
    if (cached) {
        _config = cached;
        if (cached.gtm_id) injectGtm(cached.gtm_id, cached.consent_mode);
    }

    // Background revalidate. Don't await — we don't want to block render.
    void fetchLiveConfig().then((live) => {
        if (!live) return;
        const changed =
            live.gtm_id !== _config.gtm_id ||
            live.track_logged_in !== _config.track_logged_in ||
            live.consent_mode !== _config.consent_mode;
        if (changed) {
            writeCachedConfig(live);
            _config = live;
        }
        // First-ever load (nothing cached): inject now so we still capture
        // the rest of the session.
        if (!cached && live.gtm_id) injectGtm(live.gtm_id, live.consent_mode);
    });
}

export function getAnalyticsConfig(): AnalyticsConfig {
    return _config;
}

/**
 * Push a virtual pageview into dataLayer. Safe to call before GTM has
 * loaded — dataLayer is just an array until then.
 */
export function pushPageView(path: string, title: string): void {
    if (!_config.gtm_id) return;
    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).dataLayer.push({
        event:      "page_view",
        page_path:  path,
        page_title: title,
        page_location: window.location.href,
    });
}

// Marketing surfaces — public, no auth required, fair to track.
// Anything else (the operator console, customer/partner/distributor portals)
// is intentionally excluded so we don't leak org names / endpoint IDs into
// GA and so the marketing team sees a clean funnel.
const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
    /^\/$/,
    /^\/login$/,
    /^\/signup$/,
    /^\/reset-password$/,
    /^\/channel-program$/,
    /^\/contact-sales$/,
    /^\/personal$/,
    /^\/blog(\/|$)/,
    /^\/guides(\/|$)/,
    /^\/privacy$/,
    /^\/terms$/,
    /^\/security$/,
    /^\/acceptable-use$/,
    /^\/status$/,
];

export function isPublicMarketingRoute(path: string): boolean {
    return PUBLIC_ROUTE_PATTERNS.some((re) => re.test(path));
}
