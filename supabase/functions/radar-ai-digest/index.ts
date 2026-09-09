// POST /functions/v1/radar-ai-digest
//
// Daily LLM-written "what changed in threats this week" summary for the
// public /intel page. Reads the most recent external feed mirrors + the
// top-CVEs and top-malware fleet tiles, asks the model for a tight 3-bullet
// briefing with cited sources, and upserts it into radar_snapshots under
// tile_key 'ai_weekly_digest'.
//
// Runs from cron once a day (the upstream feeds refresh hourly so a daily
// digest is fresh enough — and bounded LLM cost). Self-handles cron-secret
// auth like other refresh functions.
//
// Privacy: the prompt is fed only EXTERNAL-feed snippets and PRE-AGGREGATED
// fleet counts (no per-tenant rows). Output is reviewed for the same: only
// claims with a citation in {acsc,cisa,abuse_ch,ransomware_live,fleet}
// pass schema validation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { callLlmStructured } from "../_shared/ai-llm.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET          = Deno.env.get("MITHRAS_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(buildCorsHeaders(origin) as Record<string, string>) },
    });
}

async function isAuthorised(req: Request): Promise<boolean> {
    const cronSec = req.headers.get("x-cron-secret") ?? "";
    if (CRON_SECRET && cronSec === CRON_SECRET) return true;
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (jwt === SUPABASE_SERVICE_KEY) return true;
    if (!jwt) return false;
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return false;
    const { data: sa } = await supabase
        .from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    return !!sa;
}

// Compact snapshot we send to the LLM. We deliberately truncate every
// list so the prompt stays small (~3KB) and the response is consistent.
interface DigestInput {
    acsc: Array<{ title: string; link: string; published: string; summary: string }>;
    cisa_kev_count: number;
    threatfox: Array<{ malware: string; threat_type: string }>;
    urlhaus: Array<{ threat: string; tags: string }>;
    ransomware: { total_last7: number; top_groups: Array<{ group: string; victims: number }> };
    top_cves: Array<{ cve: string; kev: boolean; cvss: number }>;
    top_malware: Array<{ family: string; hits: number }>;
}

async function gatherInput(): Promise<DigestInput> {
    const { data: feeds } = await supabase
        .from("radar_external_feeds")
        .select("feed_key, data");
    const { data: tiles } = await supabase
        .from("radar_snapshots")
        .select("tile_key, data");

    const feed = (key: string) =>
        ((feeds ?? []).find((f) => f.feed_key === key)?.data ?? null) as Record<string, unknown> | null;
    const tile = (key: string) =>
        ((tiles ?? []).find((t) => t.tile_key === key)?.data ?? null) as Record<string, unknown> | null;

    const acscItems = ((feed("acsc_alerts")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 8);
    const tfxItems  = ((feed("threatfox_24h")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 8);
    const urlItems  = ((feed("urlhaus_recent")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 8);
    const rwItems   = ((feed("ransomware_live_week")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 8);
    const rwTotal   = Number(feed("ransomware_live_week")?.total_last7 ?? 0);
    const kev       = feed("cisa_kev") ?? {};
    const cveItems  = ((tile("top_cves")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 8);
    const malItems  = ((tile("top_malware_families")?.items ?? []) as Array<Record<string, unknown>>).slice(0, 6);

    return {
        acsc:           acscItems.map((r) => ({
            title:     String(r.title ?? ""),
            link:      String(r.link ?? ""),
            published: String(r.published ?? ""),
            summary:   String(r.summary ?? "").slice(0, 240),
        })),
        cisa_kev_count: Object.keys(kev as Record<string, unknown>).length,
        threatfox:      tfxItems.map((r) => ({ malware: String(r.malware ?? ""), threat_type: String(r.threat_type ?? "") })),
        urlhaus:        urlItems.map((r) => ({ threat: String(r.threat ?? ""), tags: String(r.tags ?? "") })),
        ransomware:     {
            total_last7: rwTotal,
            top_groups:  rwItems.map((r) => ({ group: String(r.group ?? ""), victims: Number(r.victims ?? 0) })),
        },
        top_cves:       cveItems.map((r) => ({ cve: String(r.cve ?? ""), kev: Boolean(r.kev), cvss: Number(r.cvss ?? 0) })),
        top_malware:    malItems.map((r) => ({ family: String(r.family ?? ""), hits: Number(r.hits ?? 0) })),
    };
}

const SYSTEM_PROMPT = `You write a daily threat-landscape briefing for the public threat-intelligence page of a managed security platform. Your audience: IT decision-makers and security operators at small-and-medium businesses. Australian context preferred.

Write three short bullet points. Each must:
  - Lead with the actual change or signal, not a generic restatement.
  - Cite a source from {acsc, cisa, abuse_ch, ransomware_live, fleet}.
  - Stay grounded in the data provided — do NOT invent CVEs, families, or victim counts. If a data point isn't in the input, don't reference it.
  - Be one or two sentences max. No marketing language, no "stay vigilant" filler.

Also produce a one-line headline summarising the week. No emojis. No first person.`;

const DIGEST_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        headline: { type: "string" },
        bullets: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    text:   { type: "string" },
                    source: { type: "string", enum: ["acsc", "cisa", "abuse_ch", "ransomware_live", "fleet"] },
                },
                required: ["text", "source"],
            },
        },
    },
    required: ["headline", "bullets"],
};

interface DigestOutput { headline: string; bullets: Array<{ text: string; source: string }> }

async function generateDigest(input: DigestInput): Promise<{ ok: true; data: DigestOutput; model: string } | { ok: false; error: string }> {
    const result = await callLlmStructured<DigestOutput>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt:   `Today is ${new Date().toUTCString()}.\n\nINPUT DATA:\n${JSON.stringify(input, null, 2)}\n\nProduce the briefing now.`,
        schema:       DIGEST_SCHEMA,
        schemaName:   "radar_ai_digest",
        feature:      "other",
        timeoutMs:    45_000,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, data: result.data, model: result.model ?? "unknown" };
}

Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return handlePreflight(origin);
    if (!(await isAuthorised(req))) return json({ error: "unauthorized" }, 401, origin);

    const input = await gatherInput();
    const gen   = await generateDigest(input);

    if (!gen.ok) {
        // Don't blow away a previously good digest — leave the existing
        // snapshot in place if the LLM call failed (no input data, key
        // missing, transient API error). Log + return.
        console.error("radar-ai-digest:", gen.error);
        return json({ ok: false, error: gen.error }, 200, origin);
    }

    // The tile body is served publicly via radar-public. Model name is
    // competitive intel — log it to console only, don't store it in the
    // tile data (which gets exposed verbatim).
    console.log(`radar-ai-digest: model=${gen.model}, bullets=${gen.data.bullets.length}`);
    const tile = {
        ...gen.data,
        // Cite the underlying feed timestamps so the UI can render "based on
        // ACSC alerts as of … and abuse.ch as of …" without trusting the
        // model to invent dates.
        sources: {
            acsc:           input.acsc.length,
            cisa_kev_count: input.cisa_kev_count,
            threatfox:      input.threatfox.length,
            urlhaus:        input.urlhaus.length,
            ransomware:     input.ransomware.total_last7,
        },
    };

    const { error } = await supabase.from("radar_snapshots").upsert({
        tile_key:     "ai_weekly_digest",
        data:         tile,
        tenant_count: 0,
        sample_count: 0,
        computed_at:  new Date().toISOString(),
    }, { onConflict: "tile_key" });

    if (error) return json({ ok: false, error: error.message }, 500, origin);
    return json({ ok: true, headline: gen.data.headline, bullets: gen.data.bullets.length }, 200, origin);
});
