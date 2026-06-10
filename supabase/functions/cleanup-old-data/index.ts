import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function unauthorized(msg = "Unauthorized") {
  return new Response(JSON.stringify({ error: msg }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function forbidden(msg = "Forbidden") {
  return new Response(JSON.stringify({ error: msg }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}


/**
 * Data retention cleanup function
 * 
 * This function cleans up old data from high-volume tables to reduce disk IO:
 * 1. endpoint_status - Keep only records from last 24 hours (plus latest per endpoint)
 * 2. endpoint_event_logs - Honor per-org retention settings
 * 3. endpoint_logs - Keep only last 7 days of agent logs
 * 
 * Can be called via cron job or manually.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- auth guard: super-admin only (cleanup is destructive) ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized("Missing bearer token");
  const authRes = await supabase.auth.getUser(token);
  if (authRes.error || !authRes.data.user) return unauthorized("Invalid token");
  const sa = await supabase.from("super_admins").select("user_id").eq("user_id", authRes.data.user.id).maybeSingle();
  if (sa.error || !sa.data) return forbidden("Super-admin only");

  try {
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 50_000; // 50 seconds max to stay within edge function timeout
    const shouldContinue = () => Date.now() - startTime < MAX_RUNTIME_MS;

    const results = {
      endpoint_status_deleted: 0,
      endpoint_event_logs_deleted: 0,
      endpoint_logs_deleted: 0,
      errors: [] as string[],
    };

    // 1. Clean up old endpoint_status records
    // Keep last 24 hours of status records, but always keep at least the latest per endpoint
    try {
      // DB-side DISTINCT ON via RPC. The old approach selected every row in
      // endpoint_status (millions on a real fleet) into edge-fn memory and
      // computed latest-per-endpoint in JS — OOM at scale, cleanup silently
      // failed, retention violated.
      const { data: preserveRows, error: preserveErr } = await supabase
        .rpc("get_latest_endpoint_status_ids");
      if (preserveErr) throw preserveErr;
      const preserveIds = (preserveRows as Array<{ get_latest_endpoint_status_ids: string }> | string[] | null)
        ?.map((r) => typeof r === "string" ? r : r.get_latest_endpoint_status_ids)
        ?? [];

      // Empty preserve list (e.g. brand new instance with no endpoints, or
      // a wipe-and-reseed) would build .not('id','in','()'), which PostgREST
      // returns 400 on. Without an explicit error check downstream, toDelete
      // came back null, hasMore went false, retention silently stopped.
      // Skip the delete pass entirely when there is nothing to preserve -
      // there can't be anything to clean up either.
      if (preserveIds.length === 0) {
        console.log("[cleanup-old-data] no endpoint_status rows to preserve - skipping pass");
      } else {
        const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        let hasMore = true;
        while (hasMore && shouldContinue()) {
          const { data: toDelete, error: selectErr } = await supabase
            .from("endpoint_status")
            .select("id")
            .lt("collected_at", cutoffTime)
            .not("id", "in", `(${preserveIds.join(",")})`)
            .limit(500);

          // Bubble the PostgREST error up so the outer try{} captures it
          // and pushes a useful diagnostic into results.errors instead of
          // silently exiting the loop.
          if (selectErr) throw selectErr;

          if (!toDelete || toDelete.length === 0) {
            hasMore = false;
            break;
          }

          const deleteIds = toDelete.map((r) => r.id);
          for (let i = 0; i < deleteIds.length; i += 100) {
            const batch = deleteIds.slice(i, i + 100);
            const { error } = await supabase
              .from("endpoint_status")
              .delete()
              .in("id", batch);

            if (error) {
              results.errors.push(`endpoint_status batch delete error: ${error.message}`);
              hasMore = false;
              break;
            } else {
              results.endpoint_status_deleted += batch.length;
            }
          }
        }
      }
    } catch (e) {
      results.errors.push(`endpoint_status cleanup error: ${e}`);
    }

    // 2. Clean up old endpoint_event_logs based on per-org retention settings
    try {
      // Get all organizations with their retention settings
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, event_log_retention_days");

      for (const org of orgs || []) {
        const retentionDays = org.event_log_retention_days || 30;
        const cutoffTime = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

        // Get endpoint IDs for this org
        const { data: endpoints } = await supabase
          .from("endpoints")
          .select("id")
          .eq("organization_id", org.id);

        if (!endpoints || endpoints.length === 0) continue;

        const endpointIds = endpoints.map((e) => e.id);

        // Delete old event logs for these endpoints
        const { data: toDelete } = await supabase
          .from("endpoint_event_logs")
          .select("id")
          .in("endpoint_id", endpointIds)
          .lt("event_time", cutoffTime)
          .limit(1000);

        if (toDelete && toDelete.length > 0) {
          const deleteIds = toDelete.map((r) => r.id);
          const { error } = await supabase
            .from("endpoint_event_logs")
            .delete()
            .in("id", deleteIds);

          if (error) {
            results.errors.push(`endpoint_event_logs delete error for org ${org.id}: ${error.message}`);
          } else {
            results.endpoint_event_logs_deleted += deleteIds.length;
          }
        }
      }
    } catch (e) {
      results.errors.push(`endpoint_event_logs cleanup error: ${e}`);
    }

    // 3. Clean up old endpoint_logs (agent operational logs) - keep 7 days
    try {
      const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      let hasMore = true;
      while (hasMore && shouldContinue()) {
        const { data: toDelete } = await supabase
          .from("endpoint_logs")
          .select("id")
          .lt("created_at", cutoffTime)
          .limit(500);

        if (!toDelete || toDelete.length === 0) {
          hasMore = false;
          break;
        }

        const deleteIds = toDelete.map((r) => r.id);
        for (let i = 0; i < deleteIds.length; i += 100) {
          const batch = deleteIds.slice(i, i + 100);
          const { error } = await supabase
            .from("endpoint_logs")
            .delete()
            .in("id", batch);

          if (error) {
            results.errors.push(`endpoint_logs batch delete error: ${error.message}`);
            hasMore = false;
            break;
          } else {
            results.endpoint_logs_deleted += batch.length;
          }
        }
      }
    } catch (e) {
      results.errors.push(`endpoint_logs cleanup error: ${e}`);
    }

    console.log("Cleanup completed:", results);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Data cleanup completed",
        ...results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

