import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scroll to top on every route change. If the new URL has a hash, scroll
 * the matching element into view after the page has rendered (50ms is
 * usually enough for the next paint; lazy-loaded sections will still miss).
 *
 * Mount once inside <BrowserRouter>.
 */
export default function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.replace(/^#/, "");
      const tryScroll = (attempt = 0) => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (attempt < 6) setTimeout(() => tryScroll(attempt + 1), 80);
      };
      tryScroll();
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);

  return null;
}
