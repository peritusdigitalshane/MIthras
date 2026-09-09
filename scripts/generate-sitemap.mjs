// Build-time sitemap generator for Mithras Threat Defence.
//
// Run via `npm run build` (chained before vite build). Crawls
// src/content/blog/*.md for blog post slugs + frontmatter dates, combines
// with the static marketing route list, and writes public/sitemap.xml.
//
// Keep STATIC_ROUTES in sync with the marketing-facing routes in App.tsx.
// (Protected /dashboard, /endpoints, etc. are deliberately excluded — they
// require auth and shouldn't be indexed.)

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SITE_URL = "https://www.mithras.com.au";
const BLOG_DIR = join(ROOT, "src", "content", "blog");
const OUTPUT = join(ROOT, "public", "sitemap.xml");

const STATIC_ROUTES = [
    { path: "/",                priority: "1.0", changefreq: "weekly"  },
    { path: "/platform",        priority: "0.9", changefreq: "monthly" },
    { path: "/ai-soc",          priority: "0.9", changefreq: "monthly" },
    { path: "/phishing-protection", priority: "0.9", changefreq: "monthly" },
    { path: "/identity-defence", priority: "0.9", changefreq: "monthly" },
    { path: "/m365-shield",     priority: "0.9", changefreq: "monthly" },
    { path: "/for-msps",        priority: "0.9", changefreq: "monthly" },
    { path: "/eol-windows",     priority: "0.9", changefreq: "monthly" },
    { path: "/personal",        priority: "0.8", changefreq: "monthly" },
    { path: "/intel",           priority: "0.8", changefreq: "hourly"  },
    { path: "/pricing",         priority: "0.9", changefreq: "monthly" },
    { path: "/channel-program", priority: "0.8", changefreq: "monthly" },
    { path: "/contact-sales",   priority: "0.7", changefreq: "monthly" },
    { path: "/blog",            priority: "0.8", changefreq: "weekly"  },
    // /guides removed 2026-06-16: nginx returns 403 on /guides/ trailing-
    // slash variant, surfaces as Broken_redirect + 4XX_page in the SEO
    // audit. Re-add once nginx falls through to /index.html on /guides/.
    // /signup removed: free-trial self-signup was disabled (task #234), so
    // /signup is a defunct entry point. Login page handles its own redirect.
    { path: "/security",        priority: "0.5", changefreq: "monthly" },
    { path: "/status",          priority: "0.3", changefreq: "weekly"  },
    { path: "/privacy",         priority: "0.3", changefreq: "yearly"  },
    { path: "/terms",           priority: "0.3", changefreq: "yearly"  },
    { path: "/acceptable-use",  priority: "0.3", changefreq: "yearly"  },
];

function readBlogPosts() {
    const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
    return files.map((file) => {
        const slug = file.replace(/\.md$/, "");
        const raw = readFileSync(join(BLOG_DIR, file), "utf8");
        const fm = raw.match(/^---\n([\s\S]*?)\n---/);
        const body = fm ? fm[1] : "";
        const get = (k) => {
            const m = body.match(new RegExp(`^${k}:\\s*"?([^"\n]+)"?$`, "m"));
            return m ? m[1].trim() : null;
        };
        return {
            slug,
            publishedAt: get("publishedAt"),
            updatedAt: get("updatedAt") ?? get("publishedAt"),
        };
    });
}

function urlElement({ path, lastmod, priority, changefreq }) {
    const loc = `${SITE_URL}${path}`;
    return [
        "  <url>",
        `    <loc>${loc}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
        priority ? `    <priority>${priority}</priority>` : null,
        "  </url>",
    ].filter(Boolean).join("\n");
}

function main() {
    const today = new Date().toISOString().slice(0, 10);
    const posts = readBlogPosts();
    const entries = [
        ...STATIC_ROUTES.map((r) => ({ ...r, lastmod: today })),
        ...posts.map((p) => ({
            path: `/blog/${p.slug}`,
            lastmod: p.updatedAt ?? today,
            priority: "0.7",
            changefreq: "monthly",
        })),
    ];

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries.map(urlElement),
        "</urlset>",
        "",
    ].join("\n");

    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, xml, "utf8");
    console.log(`Wrote ${entries.length} URLs to ${OUTPUT}`);
}

main();
