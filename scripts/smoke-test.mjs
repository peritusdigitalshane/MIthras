// scripts/smoke-test.mjs — real-browser smoke test of the live site.
//
// Loads each route in headless Chromium, captures console errors, network
// failures (own-origin only), and verifies expected content is actually
// rendered (not just the shell). Saves a screenshot of every page.
//
// Run: node scripts/smoke-test.mjs

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "https://www.mithras.com.au";
const OUT = "smoke-out";
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Substrings are case-insensitive. Picked to match the rendered text on
// each route's actual page component. ANY-of semantics (at least one
// must match) so wording can shift without false-failing.
const ROUTES = [
    { path: "/",                    label: "Home",      anyOf: ["Mithras", "AI SOC", "endpoint"] },
    { path: "/platform",            label: "Platform",  anyOf: ["platform", "Defender", "console"] },
    { path: "/ai-soc",              label: "AI SOC",    anyOf: ["AI SOC", "analyst", "triage"] },
    { path: "/phishing-protection", label: "Phishing",  anyOf: ["phishing", "email security", "M365"] },
    { path: "/identity-defence", label: "Identity",  anyOf: ["Identity Defence", "Conditional Access", "P1 licence"] },
    { path: "/m365-shield",      label: "M365 Shield", anyOf: ["M365 Shield", "Entra ID", "Premium upgrade", "PIM"] },
    { path: "/for-msps",            label: "For MSPs",  anyOf: ["MSP", "partner", "channel"] },
    { path: "/eol-windows",         label: "EOL Win",   anyOf: ["End-of-life", "End of life", "Windows 7", "Windows 10", "legacy"] },
    { path: "/personal",            label: "Personal",  anyOf: ["Personal", "$6", "home", "subscribe"] },
    { path: "/intel",               label: "Intel",     anyOf: ["intel", "threat", "indicator"] },
    { path: "/pricing",             label: "Pricing",   anyOf: ["Pricing", "$", "per endpoint", "month"] },
    { path: "/channel-program",     label: "Channel",   anyOf: ["partner", "Channel", "margin", "reseller"] },
    { path: "/contact-sales",       label: "Contact",   anyOf: ["Contact", "sales", "email"] },
    { path: "/blog",                label: "Blog",      anyOf: ["blog", "Blog", "post", "Defender"] },
    { path: "/security",            label: "Security",  anyOf: ["Security", "compliance", "data"] },
    { path: "/status",              label: "Status",    anyOf: ["Status", "operational", "uptime"] },
    { path: "/privacy",             label: "Privacy",   anyOf: ["Privacy", "personal information"] },
    { path: "/terms",               label: "Terms",     anyOf: ["Terms", "Service"] },
    { path: "/acceptable-use",      label: "AUP",       anyOf: ["Acceptable", "use", "abuse"] },
    { path: "/login",               label: "Login",     anyOf: ["Sign in", "email", "Password"] },
    { path: "/signup",              label: "Signup",    anyOf: ["account", "Email"] },
    { path: "/forgot-password",     label: "Forgot pw", anyOf: ["Sign in", "email"] },  // redirects to /login
    { path: "/guides",              label: "Guides",    anyOf: ["Guides", "guide", "walkthrough"] },
    { path: "/account",             label: "Account",   anyOf: ["Sign in", "Mithras", "account"] },  // unauth → login
    { path: "/dashboard",           label: "Dashboard", anyOf: ["Sign in", "Mithras"] },             // unauth → login
];

const { default: puppeteer } = await import("puppeteer");
const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const results = [];
let okCount = 0, failCount = 0, warnCount = 0;

for (const r of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Don't block telemetry — blocking causes console errors which then
    // get counted as page errors. Let GA load naturally; we filter the
    // errors below to ignore third-party domains.

    const errors = [];
    const failed = [];
    const console_errs = [];
    page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // Ignore 3rd-party telemetry noise that doesn't reach our codebase.
        if (t.includes("google-analytics") || t.includes("googletagmanager") || t.includes("doubleclick")) return;
        if (/Failed to load resource:\s*net::/.test(t)) return; // generic browser noise; we already capture requestfailed
        console_errs.push(t.slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
    page.on("requestfailed", (req) => {
        const u = req.url();
        const reason = req.failure()?.errorText ?? "";
        // Only flag own-origin failures + abort caused by us (telemetry block) is fine
        if (reason === "net::ERR_ABORTED") return;
        if (u.includes("mithras.com.au")) failed.push(`${reason} ${u}`);
    });

    let httpStatus = 0, title = "", h1 = "", text = "", goerr = "";
    try {
        // domcontentloaded is enough — networkidle0 can hang on long-poll connections.
        const resp = await page.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 15000 });
        httpStatus = resp?.status() ?? 0;
        // Wait for React to render — look for the root div to have children.
        await page.waitForFunction(
            () => (document.querySelector("#root")?.children.length ?? 0) > 0,
            { timeout: 8000 },
        ).catch(() => { /* fall through with empty text */ });
        // Settle helmet + any deferred sets
        await new Promise((res) => setTimeout(res, 500));
        title = await page.title();
        h1 = await page.evaluate(() => {
            const h = document.querySelector("h1");
            return h ? (h.textContent || "").trim().slice(0, 120) : "";
        });
        text = await page.evaluate(() => (document.body?.innerText || "").slice(0, 8000));
    } catch (e) {
        goerr = String(e.message || e).slice(0, 200);
    }

    const lowerText = text.toLowerCase();
    const matched = r.anyOf.some((s) => lowerText.includes(s.toLowerCase()));

    let verdict = "PASS";
    const issues = [];
    if (goerr) { verdict = "FAIL"; issues.push("goto: " + goerr); }
    else if (httpStatus !== 200) { verdict = "FAIL"; issues.push("status " + httpStatus); }
    else if (!matched) { verdict = "FAIL"; issues.push("none of [" + r.anyOf.join(",") + "] found"); }
    if (errors.length > 0) {
        verdict = verdict === "PASS" ? "WARN" : verdict;
        issues.push("pageerr×" + errors.length);
    }
    if (failed.length > 0) {
        verdict = verdict === "PASS" ? "WARN" : verdict;
        issues.push("reqfail×" + failed.length);
    }
    if (console_errs.length > 0) {
        verdict = verdict === "PASS" ? "WARN" : verdict;
        issues.push("console-err×" + console_errs.length);
    }

    const fn = r.path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
    try { await page.screenshot({ path: join(OUT, fn + ".png"), fullPage: false }); }
    catch (e) { issues.push("screenshot: " + e.message); }

    results.push({
        label: r.label, path: r.path, verdict,
        httpStatus, finalUrl: page.url(), title: title.slice(0, 80),
        h1: h1 || "(none)", textLen: text.length, matched, issues,
        errors, failed, console_errs,
    });

    if (verdict === "PASS") okCount++;
    else if (verdict === "WARN") warnCount++;
    else failCount++;

    const color = verdict === "PASS" ? "\x1b[32m" : verdict === "WARN" ? "\x1b[33m" : "\x1b[31m";
    console.log(`${color}${verdict}\x1b[0m ${r.path.padEnd(24)} ${String(httpStatus).padStart(3)} ${(h1 || "—").slice(0, 50).padEnd(50)} ${issues.length ? "| " + issues.join("; ") : ""}`);
    for (const e of errors.slice(0, 3))     console.log(`     pageerr: ${e}`);
    for (const c of console_errs.slice(0, 3)) console.log(`     conserr: ${c}`);
    for (const f of failed.slice(0, 3))     console.log(`     reqfail: ${f}`);
    await page.close();
}

await browser.close();
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

console.log("");
console.log(`====== smoke test summary ======`);
console.log(`  PASS: ${okCount}`);
console.log(`  WARN: ${warnCount}`);
console.log(`  FAIL: ${failCount}`);
console.log(`  details + screenshots: ./${OUT}/`);
process.exit(failCount > 0 ? 1 : 0);
