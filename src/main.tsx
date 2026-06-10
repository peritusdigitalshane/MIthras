import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { bootAnalytics } from "./lib/analytics";

// Boot analytics BEFORE React mounts. Reads localStorage and injects GTM
// synchronously if cached; revalidates in the background. Safe to call —
// returns immediately and is a no-op if no GTM ID is configured.
bootAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
