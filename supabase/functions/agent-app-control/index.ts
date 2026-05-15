// POST /functions/v1/agent-app-control/observed
// Headers: X-Agent-Id, X-Timestamp, X-Signature
// Body:
//   {
//     "since": "ISO-8601",
//     "apps": [
//       { file_path, file_hash?, file_name?, product_name?, publisher?, file_version?, first_seen, exec_count }
//     ]
//   }
// Response 200: { upserted: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";
import { extractHmacRequest, verifyHmacRequest } from "../_shared/hmac.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type ObservedApp = {
    file_path: string;
    file_hash?: string;
    file_name?: string;
    product_name?: string;
    publisher?: string;
    file_version?: string;
    first_seen?: string;
    exec_count?: number;
};

// Maps path prefixes (uppercase) → display publisher name.
// Checked in order; first match wins.
const PUBLISHER_PREFIXES: [string, string][] = [
    ["C:\\WINDOWS\\", "Windows"],
    ["C:\\PROGRAM FILES\\MICROSOFT OFFICE\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\MICROSOFT OFFICE 16\\", "Microsoft"],
    ["C:\\PROGRAM FILES (X86)\\MICROSOFT OFFICE\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\MICROSOFT\\", "Microsoft"],
    ["C:\\PROGRAM FILES (X86)\\MICROSOFT\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\COMMON FILES\\MICROSOFT SHARED\\", "Microsoft"],
    ["C:\\PROGRAM FILES\\WINDOWSAPPS\\MICROSOFT.", "Microsoft"],
    ["C:\\PROGRAM FILES\\GOOGLE\\CHROME\\", "Google"],
    ["C:\\PROGRAM FILES (X86)\\GOOGLE\\CHROME\\", "Google"],
    ["C:\\PROGRAM FILES\\ADOBE\\", "Adobe"],
    ["C:\\PROGRAM FILES (X86)\\ADOBE\\", "Adobe"],
    ["C:\\PROGRAM FILES\\MOZILLA FIREFOX\\", "Mozilla"],
    ["C:\\PROGRAM FILES\\VIDEOLAN\\", "VLC"],
    ["C:\\PROGRAM FILES\\7-ZIP\\", "7-Zip"],
    ["C:\\PROGRAM FILES\\NOTEPAD++\\", "Notepad++"],
    ["C:\\PROGRAM FILES\\WINRAR\\", "WinRAR"],
    ["C:\\PROGRAM FILES\\TEAMVIEWER\\", "TeamViewer"],
    ["C:\\PROGRAM FILES\\ZOOM\\", "Zoom"],
    ["C:\\PROGRAM FILES\\SLACK TECHNOLOGIES\\", "Slack"],
    ["C:\\PROGRAM FILES\\DROPBOX\\", "Dropbox"],
    ["C:\\PROGRAM FILES (X86)\\DROPBOX\\", "Dropbox"],
    ["C:\\PROGRAM FILES\\CITRIX\\", "Citrix"],
    ["C:\\PROGRAM FILES (X86)\\CITRIX\\", "Citrix"],
];

function inferPublisher(filePath: string): string {
    const upper = filePath.toUpperCase();
    for (const [prefix, pub] of PUBLISHER_PREFIXES) {
        if (upper.startsWith(prefix)) return pub;
    }
    return "Unknown / Unsigned";
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            ...(buildCorsHeaders(origin) as Record<string, string>),
        },
    });
}

Deno.serve(async (request) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = request.headers.get("origin");

    if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, origin);
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith("/observed")) {
        return jsonResponse({ error: "not_found" }, 404, origin);
    }

    const hmacReq = await extractHmacRequest(request);
    if (!hmacReq) return jsonResponse({ error: "missing_hmac_headers" }, 401, origin);

    const { data: endpoint, error: lookupErr } = await supabase
        .from("endpoints")
        .select("id, organization_id, agent_secret, is_active")
        .eq("id", hmacReq.agentId)
        .maybeSingle();
    if (lookupErr) {
        console.error("endpoint lookup failed", lookupErr);
        return jsonResponse({ error: "internal" }, 500, origin);
    }
    if (!endpoint || !endpoint.agent_secret || !endpoint.is_active) {
        return jsonResponse({ error: "agent_unknown_or_inactive" }, 401, origin);
    }

    const verification = await verifyHmacRequest(hmacReq, endpoint.agent_secret);
    if (!verification.ok) {
        return jsonResponse({ error: "hmac_invalid", reason: verification.reason }, 401, origin);
    }

    let body: { since?: string; apps?: ObservedApp[] };
    try {
        body = JSON.parse(hmacReq.rawBody || "{}");
    } catch {
        return jsonResponse({ error: "invalid_json" }, 400, origin);
    }

    const apps = Array.isArray(body.apps) ? body.apps : [];
    if (apps.length === 0) {
        return jsonResponse({ upserted: 0 }, 200, origin);
    }

    const rows = apps.map(a => ({
        organization_id:  endpoint.organization_id,
        endpoint_id:      endpoint.id,
        file_name:        a.file_name ?? a.file_path.split(/[\\/]/).pop() ?? "unknown",
        file_path:        a.file_path,
        file_hash:        a.file_hash ?? "",
        publisher:        a.publisher ?? inferPublisher(a.file_path),
        product_name:     a.product_name ?? null,
        file_version:     a.file_version ?? null,
        discovery_source: "event_log",
        first_seen_at:    a.first_seen ?? new Date().toISOString(),
        last_seen_at:     new Date().toISOString(),
        execution_count:  Math.max(1, a.exec_count ?? 1),
    }));

    const { error: upsertErr, count } = await supabase
        .from("wdac_discovered_apps")
        .upsert(rows, { onConflict: "endpoint_id,file_path,file_hash", count: "exact" });
    if (upsertErr) {
        console.error("wdac_discovered_apps upsert", upsertErr);
        return jsonResponse({ error: "upsert_failed", details: upsertErr.message }, 500, origin);
    }

    return jsonResponse({ upserted: count ?? rows.length }, 200, origin);
});
