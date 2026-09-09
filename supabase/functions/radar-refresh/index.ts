// POST /functions/v1/radar-refresh
//
// Refresh every tile in radar_snapshots, refresh the external feed mirrors,
// and let the public /radar page read a clean snapshot. Runs hourly from
// pg_cron and on-demand from the /admin button (super-admin only).
//
// Each tile:
//   1. Call the public.radar_tile_* SQL function to get the aggregated jsonb.
//   2. Apply the per-tile MIN_TENANTS floor (suppresses tiles where too few
//      tenants contribute — privacy guard for early-stage rollout).
//   3. UPSERT into public.radar_snapshots by tile_key.
//
// External feeds (CISA KEV, urlhaus, threatfox) are fetched here and cached
// in public.radar_external_feeds so the public page never touches an
// upstream HTTP endpoint.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Per-tile minimum-tenants floor. Tiles below this are stored but flagged
// `suppressed: true`; the public endpoint hides them.
const MIN_TENANTS: Record<string, number> = {
    threats_blocked_week:        3,
    top_malware_families:        3,
    top_cves:                    3,
    eol_exposure:                3,
    brute_force_ports:           3,
    attack_origins:              3,
    phishing_themes:             3,
    wp_bruteforce_trend:         0,   // fleet-wide signal that doesn't reveal a tenant
};

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function isAuthorised(req: Request): Promise<boolean> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;

    const auth = req.headers.get("Authorization") ?? "";
    const jwt  = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return false;
    if (jwt === SUPABASE_SERVICE_KEY) return true;

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return false;
    const { data: sa } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    return !!sa;
}

interface TileResult {
    tile_key: string;
    rpc: string;
    ok: boolean;
    error?: string;
    tenants?: number;
    suppressed?: boolean;
}

async function refreshTile(tile_key: string, rpc: string): Promise<TileResult> {
    try {
        const { data, error } = await supabase.rpc(rpc);
        if (error) return { tile_key, rpc, ok: false, error: error.message };

        const tenants: number = (data?.tenants ?? 0) as number;
        const floor = MIN_TENANTS[tile_key] ?? 3;
        const suppressed = tenants < floor;

        const { error: upErr } = await supabase
            .from("radar_snapshots")
            .upsert({
                tile_key,
                data,
                tenant_count: tenants,
                sample_count: countSamples(data),
                computed_at: new Date().toISOString(),
            }, { onConflict: "tile_key" });
        if (upErr) return { tile_key, rpc, ok: false, error: upErr.message };
        return { tile_key, rpc, ok: true, tenants, suppressed };
    } catch (e) {
        return { tile_key, rpc, ok: false, error: (e as Error).message };
    }
}

function countSamples(data: unknown): number {
    if (!data || typeof data !== "object") return 0;
    const d = data as Record<string, unknown>;
    if (typeof d.total === "number") return d.total;
    if (Array.isArray(d.items)) {
        let s = 0;
        for (const it of d.items as Record<string, unknown>[]) {
            const v = (it.hits ?? it.attempts ?? it.detections ?? it.endpoints ?? it.count ?? 0) as number;
            s += v;
        }
        return s;
    }
    return 0;
}


// ----------------------------------------------------------------------------
// External feed mirrors. Best-effort — a feed failure does not fail the run.
// ----------------------------------------------------------------------------

async function refreshCisaKev(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
        const url = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
        const resp = await fetch(url, { headers: { accept: "application/json" } });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };
        const body = await resp.json() as { vulnerabilities?: Array<{ cveID?: string }> };
        const vulns = body.vulnerabilities ?? [];
        // Flatten to { cveID: { vendor, product, dateAdded, requiredAction } }
        const map: Record<string, unknown> = {};
        for (const v of vulns) {
            const cve = (v.cveID ?? "").toUpperCase();
            if (cve) map[cve] = v;
        }
        await supabase.from("radar_external_feeds").upsert({
            feed_key: "cisa_kev",
            data: map,
            source: url,
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: Object.keys(map).length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}

// Lightweight CSV row parser tailored to abuse.ch exports. Handles
// double-quote-wrapped fields with embedded commas. Not a general CSV parser
// — it does NOT handle escaped quotes inside quoted fields, which abuse.ch
// does not emit. Also skips a leading quoted-header row when present
// (Feodo Tracker emits one; URLhaus and ThreatFox do not).
const HEADER_TOKENS = new Set([
    "id", "first_seen", "first_seen_utc", "dateadded", "url", "dst_ip", "ioc_value",
]);
function parseAbuseChCsv(text: string): string[][] {
    const out: string[][] = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const fields: string[] = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQ = !inQ; continue; }
            if (ch === "," && !inQ) { fields.push(cur); cur = ""; continue; }
            cur += ch;
        }
        fields.push(cur);
        // Skip the first row if it's a column header (Feodo Tracker emits one
        // as a quoted line that the # filter above doesn't catch).
        if (out.length === 0 && fields[0] && HEADER_TOKENS.has(fields[0].trim().toLowerCase())) {
            continue;
        }
        out.push(fields);
    }
    return out;
}

async function refreshThreatFox(): Promise<{ ok: boolean; count: number; error?: string }> {
    // abuse.ch threatfox recent IOCs via the public CSV (no auth required).
    // The JSON API at threatfox-api.abuse.ch now requires an Auth-Key as of
    // mid-2024 and returns HTTP 401 without one; the CSV export remains free.
    // Columns: id,first_seen_utc,ioc_value,ioc_type,threat_type,malware,
    //          malware_alias,malware_printable,last_seen_utc,confidence_level,
    //          reference,tags,anonymous,reporter
    try {
        const url = "https://threatfox.abuse.ch/export/csv/recent/";
        const resp = await fetch(url, { headers: { accept: "text/csv" } });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };
        const text = await resp.text();
        const rows = parseAbuseChCsv(text);
        const items = rows.slice(0, 50).map((r) => ({
            malware:     (r[7] || r[5] || "Unknown").trim(),
            threat_type: (r[4] || "Unknown").trim(),
            ioc:         (r[2] || "").trim(),
            first_seen:  (r[1] || "").trim(),
        })).filter((r) => r.ioc);
        await supabase.from("radar_external_feeds").upsert({
            feed_key: "threatfox_24h",
            data: { items },
            source: "https://threatfox.abuse.ch (CSV export)",
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: items.length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}

async function refreshUrlhaus(): Promise<{ ok: boolean; count: number; error?: string }> {
    // abuse.ch URLhaus — recent active malware-distribution URLs (CSV, no auth).
    // Columns: id,dateadded,url,url_status,last_online,threat,tags,
    //          urlhaus_link,reporter
    try {
        const url = "https://urlhaus.abuse.ch/downloads/csv_recent/";
        const resp = await fetch(url, { headers: { accept: "text/csv" } });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };
        const text = await resp.text();
        const rows = parseAbuseChCsv(text);
        const items = rows.slice(0, 50).map((r) => ({
            dateadded:  (r[1] || "").trim(),
            url:        (r[2] || "").trim(),
            status:     (r[3] || "").trim(),
            threat:     (r[5] || "Unknown").trim(),
            tags:       (r[6] || "").trim(),
        })).filter((r) => r.url);
        await supabase.from("radar_external_feeds").upsert({
            feed_key: "urlhaus_recent",
            data: { items },
            source: "https://urlhaus.abuse.ch",
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: items.length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}

async function refreshFeodoTracker(): Promise<{ ok: boolean; count: number; error?: string }> {
    // abuse.ch Feodo Tracker — botnet C2 IP addresses (CSV, no auth).
    // Columns: first_seen,dst_ip,dst_port,c2_status,last_online,malware
    try {
        const url = "https://feodotracker.abuse.ch/downloads/ipblocklist.csv";
        const resp = await fetch(url, { headers: { accept: "text/csv" } });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };
        const text = await resp.text();
        const rows = parseAbuseChCsv(text);
        const items = rows.slice(0, 100).map((r) => ({
            first_seen:  (r[0] || "").trim(),
            ip:          (r[1] || "").trim(),
            port:        (r[2] || "").trim(),
            status:      (r[3] || "").trim(),
            malware:     (r[5] || "Unknown").trim(),
        })).filter((r) => r.ip);
        await supabase.from("radar_external_feeds").upsert({
            feed_key: "feodo_botnet_c2",
            data: { items },
            source: "https://feodotracker.abuse.ch",
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: items.length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}


// Decode XML/HTML entities that show up in RSS bodies (CISA emits
// &amp; &#x27; &quot; etc.). Deliberately minimal — we don't try to
// handle every entity, just the common ones that appear in titles.
function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g,  "&")
        .replace(/&lt;/g,   "<")
        .replace(/&gt;/g,   ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g,  "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}

// Government cyber advisories. CISA's RSS feed is the authoritative US
// source — published the moment they confirm an emerging threat. ACSC
// (Australian) does not currently expose a public JSON/RSS endpoint; once
// they do we'll add it here and merge the two streams under one tile.
async function refreshGovAdvisories(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
        const url = "https://www.cisa.gov/cybersecurity-advisories/all.xml";
        const resp = await fetch(url, {
            headers: {
                accept: "application/rss+xml, application/xml, text/xml",
                "user-agent": "Mithras-Threat-Intel/1.0 (+https://www.mithras.com.au/intel)",
            },
            signal: AbortSignal.timeout(20_000),
        });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };

        const xml = await resp.text();
        // Lightweight RSS extraction. CISA's feed uses standard <item>
        // blocks with <title>, <link>, <pubDate>, <description>. We don't
        // pull in an XML parser dependency — regex is fine for a known
        // well-formed feed and degrades to "no items" if the schema changes.
        const itemRe = /<item>([\s\S]*?)<\/item>/g;
        const tagRe  = (tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");

        const items: Array<{ title: string; link: string; published: string; summary: string; severity: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(xml)) && items.length < 20) {
            const block = m[1];
            const get   = (t: string) => (block.match(tagRe(t))?.[1] ?? "")
                .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
                .trim();
            const title = decodeEntities(get("title")).slice(0, 240);
            const link  = get("link");
            const published = get("pubDate");
            const summary = decodeEntities(get("description"))
                .replace(/<[^>]+>/g, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 320);
            if (title && link) items.push({ title, link, published, summary, severity: "" });
        }

        await supabase.from("radar_external_feeds").upsert({
            // Backwards-compatible key — the UI already wires to acsc_alerts.
            // Source label is honest in the UI tile title.
            feed_key: "acsc_alerts",
            data: { items },
            source: "https://www.cisa.gov/cybersecurity-advisories",
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: items.length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}

// Ransomware.live — public API aggregating recently-posted ransomware
// victims across known leak sites. We expose only group-level aggregates
// (which gangs are most active this week) + the victim count per group.
// Specific victim names are deliberately NOT republished by us — they're
// already public on the gangs' own sites but we don't want our brand
// associated with a victim leak.
async function refreshRansomwareLive(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
        const url = "https://api.ransomware.live/recentvictims";
        const resp = await fetch(url, {
            headers: {
                accept: "application/json",
                "user-agent": "Mithras-Threat-Intel/1.0",
            },
            signal: AbortSignal.timeout(20_000),
        });
        if (!resp.ok) return { ok: false, count: 0, error: `HTTP ${resp.status}` };
        const raw = await resp.json() as Array<Record<string, unknown>>;
        if (!Array.isArray(raw)) return { ok: false, count: 0, error: "unexpected_shape" };

        // Bucket by group, count last 7 days only.
        const sevenAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const byGroup = new Map<string, { group: string; victims: number; latest: string }>();
        let totalLast7 = 0;
        for (const row of raw) {
            const r = row as Record<string, unknown>;
            const group = String(r.group_name ?? r.group ?? "").trim();
            const attackdate = String(r.attackdate ?? r.discovered ?? r.published ?? "");
            if (!group) continue;
            const t = Date.parse(attackdate);
            if (!Number.isFinite(t) || t < sevenAgo) continue;
            totalLast7++;
            const cur = byGroup.get(group) ?? { group, victims: 0, latest: attackdate };
            cur.victims++;
            if (attackdate > cur.latest) cur.latest = attackdate;
            byGroup.set(group, cur);
        }
        const items = [...byGroup.values()]
            .sort((a, b) => b.victims - a.victims)
            .slice(0, 12);

        await supabase.from("radar_external_feeds").upsert({
            feed_key: "ransomware_live_week",
            data: { items, total_last7: totalLast7 },
            source: "https://www.ransomware.live",
            fetched_at: new Date().toISOString(),
        }, { onConflict: "feed_key" });
        return { ok: true, count: items.length };
    } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
    }
}


// ----------------------------------------------------------------------------
// Handler.
// ----------------------------------------------------------------------------

const TILES: Array<{ tile_key: string; rpc: string }> = [
    { tile_key: "threats_blocked_week",   rpc: "radar_tile_threats_blocked_week"    },
    { tile_key: "top_malware_families",   rpc: "radar_tile_top_malware_families"    },
    { tile_key: "top_cves",               rpc: "radar_tile_top_cves"                },
    { tile_key: "eol_exposure",           rpc: "radar_tile_eol_exposure"            },
    { tile_key: "brute_force_ports",      rpc: "radar_tile_brute_force_ports"       },
    { tile_key: "attack_origins",         rpc: "radar_tile_attack_origins"          },
    { tile_key: "phishing_themes",        rpc: "radar_tile_phishing_themes"         },
    { tile_key: "wp_bruteforce_trend",    rpc: "radar_tile_wp_bruteforce_trend"     },
];

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);

    if (!(await isAuthorised(req))) {
        return jsonResponse({ error: "unauthorized" }, 401, origin);
    }

    const refreshFeeds = (new URL(req.url)).searchParams.get("feeds") !== "skip";

    const tileResults: TileResult[] = [];
    for (const t of TILES) {
        tileResults.push(await refreshTile(t.tile_key, t.rpc));
    }

    const feeds: Record<string, unknown> = {};
    if (refreshFeeds) {
        feeds.cisa_kev         = await refreshCisaKev();
        feeds.threatfox        = await refreshThreatFox();
        feeds.urlhaus          = await refreshUrlhaus();
        feeds.feodo            = await refreshFeodoTracker();
        feeds.acsc_alerts      = await refreshGovAdvisories();
        feeds.ransomware_live  = await refreshRansomwareLive();
    }

    const okCount = tileResults.filter((t) => t.ok).length;
    return jsonResponse({
        ok:     okCount === TILES.length,
        tiles:  tileResults,
        feeds,
        ran_at: new Date().toISOString(),
    }, 200, origin);
});
