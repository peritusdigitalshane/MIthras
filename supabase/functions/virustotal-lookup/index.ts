import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VTAnalysisStats {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  timeout: number;
}

interface VTEnrichmentData {
  detection_ratio: string;
  malicious_count: number;
  total_engines: number;
  threat_names: string[];
  file_type: string | null;
  file_size: number | null;
  meaningful_name: string | null;
  first_submission_date: string | null;
  last_analysis_date: string | null;
  sha256: string | null;
  sha1: string | null;
  md5: string | null;
  raw_stats: VTAnalysisStats;
}

// deno-lint-ignore no-explicit-any
async function getVirusTotalApiKey(supabaseAdmin: any): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("value")
    .eq("key", "virustotal_api_key")
    .single();

  if (error || !data) {
    return null;
  }
  const record = data as { value: string | null };
  return record.value;
}

async function lookupHash(hash: string, apiKey: string): Promise<VTEnrichmentData> {
  const response = await fetch(
    `https://www.virustotal.com/api/v3/files/${hash}`,
    {
      headers: {
        "x-apikey": apiKey,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Hash not found in VirusTotal database");
    }
    if (response.status === 429) {
      throw new Error("VirusTotal rate limit exceeded. Please try again later.");
    }
    throw new Error(`VirusTotal API error: ${response.status}`);
  }

  const data = await response.json();
  const attrs = data.data?.attributes;

  if (!attrs) {
    throw new Error("Invalid response from VirusTotal");
  }

  const stats: VTAnalysisStats = attrs.last_analysis_stats || {
    malicious: 0,
    suspicious: 0,
    harmless: 0,
    undetected: 0,
    timeout: 0,
  };

  const maliciousCount = stats.malicious + stats.suspicious;
  const totalEngines = stats.malicious + stats.suspicious + stats.harmless + stats.undetected;

  // Extract threat names from results
  const threatNames: string[] = [];
  const results = attrs.last_analysis_results || {};
  for (const [, result] of Object.entries(results)) {
    const r = result as { category: string; result: string | null };
    if (r.category === "malicious" && r.result) {
      threatNames.push(r.result);
    }
  }

  // Get unique, most common threat names (top 5)
  const threatCounts: Record<string, number> = {};
  for (const name of threatNames) {
    threatCounts[name] = (threatCounts[name] || 0) + 1;
  }
  const sortedThreats = Object.entries(threatCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  return {
    detection_ratio: `${maliciousCount}/${totalEngines}`,
    malicious_count: maliciousCount,
    total_engines: totalEngines,
    threat_names: sortedThreats,
    file_type: attrs.type_description || null,
    file_size: attrs.size || null,
    meaningful_name: attrs.meaningful_name || null,
    first_submission_date: attrs.first_submission_date
      ? new Date(attrs.first_submission_date * 1000).toISOString()
      : null,
    last_analysis_date: attrs.last_analysis_date
      ? new Date(attrs.last_analysis_date * 1000).toISOString()
      : null,
    sha256: attrs.sha256 || null,
    sha1: attrs.sha1 || null,
    md5: attrs.md5 || null,
    raw_stats: stats,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user is authenticated
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get VT API key from platform settings
    const vtApiKey = await getVirusTotalApiKey(supabaseAdmin);
    if (!vtApiKey) {
      return new Response(
        JSON.stringify({ error: "VirusTotal API key not configured. Please configure it in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, hash, iocId } = await req.json();

    if (action === "lookup") {
      if (!hash) {
        return new Response(
          JSON.stringify({ error: "Hash is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const enrichment = await lookupHash(hash, vtApiKey);

      // If iocId is provided, update the IOC record with enrichment data
      if (iocId) {
        const { error: updateError } = await supabaseAdmin
          .from("ioc_library")
          .update({
            vt_enrichment: enrichment,
            vt_enriched_at: new Date().toISOString(),
            vt_detection_ratio: enrichment.detection_ratio,
          })
          .eq("id", iocId);

        if (updateError) {
          console.error("Failed to update IOC with enrichment:", updateError);
        }
      }

      return new Response(
        JSON.stringify({ success: true, enrichment }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "test") {
      // Simple connectivity test - just verify the API key works
      try {
        const testResponse = await fetch(
          "https://www.virustotal.com/api/v3/files/44d88612fea8a8f36de82e1278abb02f", // EICAR test hash
          {
            headers: { "x-apikey": vtApiKey },
            method: "HEAD",
          }
        );
        
        if (testResponse.status === 401) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid API key" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: "VirusTotal API connection successful" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to connect to VirusTotal API" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'lookup' or 'test'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in virustotal-lookup:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
