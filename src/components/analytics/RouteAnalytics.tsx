import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getAnalyticsConfig, isPublicMarketingRoute, pushPageView } from "@/lib/analytics";

interface RouteAnalyticsProps {
    /** Whether the visitor is currently signed in. Optional — when null the
     *  gating defaults to "treat as anonymous". */
    isAuthenticated?: boolean;
}

/**
 * Fires a virtual page_view into the GTM dataLayer on every React Router
 * navigation, gated to:
 *   1. routes in the public marketing allowlist (so the operator console
 *      and customer portals never leak into GA)
 *   2. anonymous visitors, unless the operator has explicitly opted in to
 *      tracking signed-in users via Settings → Analytics
 *
 * Render once near the root of the tree. Renders nothing.
 */
export function RouteAnalytics({ isAuthenticated = false }: RouteAnalyticsProps) {
    const location = useLocation();

    useEffect(() => {
        const cfg = getAnalyticsConfig();
        if (!cfg.gtm_id) return;
        if (!isPublicMarketingRoute(location.pathname)) return;
        if (isAuthenticated && !cfg.track_logged_in) return;
        pushPageView(location.pathname, document.title);
    }, [location.pathname, isAuthenticated]);

    return null;
}
