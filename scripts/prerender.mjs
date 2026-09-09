// scripts/prerender.mjs
//
// Post-build prerender for marketing routes. Solves the "SPA shell shipped
// to crawlers" problem flagged in the 2026-06-16 SEO audit (15× duplicate
// pages, 15× missing H1, 99× incomplete OG, 12× orphan pages — all the
// same root cause: every URL served the same empty index.html).
//
// How it works:
//   1. Starts a tiny static server on a free local port serving dist/.
//   2. Launches puppeteer (headless Chromium), navigates to each marketing
//      route, waits for hydration to complete (any DOM with [data-prerender-ready]
//      sentinel OR a 1.5s settle delay as fallback).
//   3. Snapshots `document.documentElement.outerHTML` and writes
//      dist/<route>/index.html.
//   4. nginx is configured to serve dist/<route>/index.html if it exists,
//      and fall through to dist/index.html (SPA shell) otherwise. So
//      crawlers see the prerendered HTML; users see the same SPA route
//      they always have.
//
// Runs as the LAST step of `npm run build`. Skipped automatically when
// SKIP_PRERENDER=1 is set (CI dry-runs, local quick rebuilds).

import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const BLOG_DIR = join(ROOT, "src", "content", "blog");

if (process.env.SKIP_PRERENDER === "1") {
    console.log("[prerender] SKIP_PRERENDER=1 — skipping.");
    process.exit(0);
}

if (!existsSync(DIST)) {
    console.error("[prerender] dist/ missing. Run `vite build` first.");
    process.exit(1);
}

// Routes mirror scripts/generate-sitemap.mjs STATIC_ROUTES — kept in sync
// manually for now. (Could be DRY'd later if we extract a shared module.)
const STATIC_ROUTES = [
    "/", "/platform", "/ai-soc", "/phishing-protection", "/for-msps",
    "/eol-windows", "/personal", "/intel", "/pricing", "/channel-program",
    "/contact-sales", "/blog", "/security", "/status", "/privacy",
    "/terms", "/acceptable-use",
];

function readBlogSlugs() {
    if (!existsSync(BLOG_DIR)) return [];
    return readdirSync(BLOG_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => "/blog/" + f.replace(/\.md$/, ""));
}

const ROUTES = [...STATIC_ROUTES, ...readBlogSlugs()];

// Minimal static server. content-type by extension, falls back to
// dist/index.html (SPA mode) when a request doesn't map to a file —
// critical so puppeteer can navigate to /pricing and get the SPA shell.
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico":  "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".xml":  "application/xml; charset=utf-8",
    ".txt":  "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
};

function serve(req, res) {
    const url = new URL(req.url, "http://localhost");
    let filePath = join(DIST, decodeURIComponent(url.pathname));
    try {
        const s = statSync(filePath);
        if (s.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
        filePath = join(DIST, "index.html"); // SPA fallback
    }
    try {
        const body = readFileSync(filePath);
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
    } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("404");
    }
}

const server = http.createServer(serve);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
console.log(`[prerender] static server listening on ${port}`);

// Lazy puppeteer load so the install doesn't run if SKIP_PRERENDER is set.
const { default: puppeteer } = await import("puppeteer");
const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

let okCount = 0;
let failCount = 0;
const t0 = Date.now();

for (const route of ROUTES) {
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 1280, height: 800 });
        // networkidle0 covers Helmet + Fonts + initial fetches. 15s timeout
        // is generous; tighten later if all routes settle under 5s.
        await page.goto(`http://127.0.0.1:${port}${route}`, {
            waitUntil: "networkidle0",
            timeout: 15_000,
        });
        // Belt-and-braces: wait an extra 200ms for any deferred Helmet
        // commits. react-helmet-async flushes synchronously, but the title
        // / canonical sometimes lag if the page does a useEffect-based fetch.
        await new Promise((r) => setTimeout(r, 200));

        const html = await page.evaluate(() => "<!doctype html>\n" + document.documentElement.outerHTML);
        const outDir = route === "/" ? DIST : join(DIST, route.replace(/^\//, ""));
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "index.html"), html);

        const title = await page.evaluate(() => document.title || "");
        console.log(`[prerender]  ok ${route.padEnd(46)} → ${title.slice(0, 60)}`);
        okCount++;
    } catch (e) {
        console.error(`[prerender] FAIL ${route} — ${e.message}`);
        failCount++;
    } finally {
        await page.close();
    }
}

await browser.close();
await new Promise((r) => server.close(r));

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[prerender] done in ${dt}s — ${okCount} ok, ${failCount} fail`);
if (failCount > 0) {
    console.error("[prerender] non-zero failure count — failing build");
    process.exit(1);
}
