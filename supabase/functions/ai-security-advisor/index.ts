import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, buildCorsHeaders } from "../_shared/cors.ts";

interface EndpointData {
  id: string;
  hostname: string;
  is_online: boolean;
  policy_id: string | null;
}

interface ThreatData {
  threat_name: string;
  severity: string;
  status: string;
  category: string | null;
}

interface StatusData {
  endpoint_id: string;
  realtime_protection_enabled: boolean | null;
  antivirus_enabled: boolean | null;
  antispyware_enabled: boolean | null;
  behavior_monitor_enabled: boolean | null;
  ioav_protection_enabled: boolean | null;
  antivirus_signature_age: number | null;
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const corsHeaders = buildCorsHeaders(req.headers.get("origin")) as Record<string, string>;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user and get their organization
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get organization_id from request body
    const { organization_id } = await req.json();
    
    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get OpenAI settings from platform_settings
    const { data: apiKeySetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "openai_api_key")
      .single();

    const { data: modelSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "openai_model")
      .single();

    if (!apiKeySetting?.value) {
      return new Response(JSON.stringify({ 
        error: "OpenAI API key not configured. Please configure it in Admin settings." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiApiKey = apiKeySetting.value;
    const model = modelSetting?.value || "gpt-4o-mini";

    // Gather security data for the organization
    const { data: endpoints } = await supabase
      .from("endpoints")
      .select("id, hostname, is_online, policy_id")
      .eq("organization_id", organization_id);

    const endpointIds = (endpoints || []).map((e: EndpointData) => e.id);

    let threats: ThreatData[] = [];
    let statuses: StatusData[] = [];

    if (endpointIds.length > 0) {
      const { data: threatData } = await supabase
        .from("endpoint_threats")
        .select("threat_name, severity, status, category")
        .in("endpoint_id", endpointIds);
      threats = threatData || [];

      const { data: statusData } = await supabase
        .from("endpoint_status")
        .select("endpoint_id, realtime_protection_enabled, antivirus_enabled, antispyware_enabled, behavior_monitor_enabled, ioav_protection_enabled, antivirus_signature_age")
        .in("endpoint_id", endpointIds)
        .order("collected_at", { ascending: false });
      
      // Get latest status per endpoint
      const latestByEndpoint = new Map<string, StatusData>();
      for (const status of statusData || []) {
        if (!latestByEndpoint.has(status.endpoint_id)) {
          latestByEndpoint.set(status.endpoint_id, status);
        }
      }
      statuses = Array.from(latestByEndpoint.values());
    }

    // Calculate summary stats
    const totalEndpoints = endpoints?.length || 0;
    const onlineEndpoints = endpoints?.filter((e: EndpointData) => e.is_online).length || 0;
    const endpointsWithPolicy = endpoints?.filter((e: EndpointData) => e.policy_id).length || 0;
    
    const resolvedStatuses = ["resolved", "removed", "blocked"];
    const activeThreats = threats.filter(t => !resolvedStatuses.includes(t.status.toLowerCase()));
    
    const realtimeEnabled = statuses.filter(s => s.realtime_protection_enabled === true).length;
    const antivirusEnabled = statuses.filter(s => s.antivirus_enabled === true).length;
    const outdatedSignatures = statuses.filter(s => s.antivirus_signature_age !== null && s.antivirus_signature_age > 1).length;
    const behaviorMonitorEnabled = statuses.filter(s => s.behavior_monitor_enabled === true).length;

    // Group threats by name for better analysis
    const threatsByName = new Map<string, { count: number; severity: string; status: string }>();
    for (const t of threats) {
      const existing = threatsByName.get(t.threat_name);
      if (existing) {
        existing.count++;
      } else {
        threatsByName.set(t.threat_name, { count: 1, severity: t.severity, status: t.status });
      }
    }

    const threatDetails = Array.from(threatsByName.entries())
      .map(([name, data]) => `  - ${name}: ${data.count} occurrence(s), severity: ${data.severity}, status: ${data.status}`)
      .join("\n");

    // Build the prompt
    const securitySummary = `
Security Summary for Organization:
- Total Endpoints: ${totalEndpoints}
- Online Endpoints: ${onlineEndpoints}
- Endpoints with Policy Assigned: ${endpointsWithPolicy}

Protection Status (of ${statuses.length} endpoints with status data):
- Real-time Protection Enabled: ${realtimeEnabled}/${statuses.length}
- Antivirus Enabled: ${antivirusEnabled}/${statuses.length}
- Behavior Monitoring Enabled: ${behaviorMonitorEnabled}/${statuses.length}
- Outdated Signatures (>1 day): ${outdatedSignatures}

Threat Summary:
- Active Threats: ${activeThreats.length}
- Total Threats Recorded (including resolved): ${threats.length}
${threatDetails ? `\nDetailed Threat Breakdown:\n${threatDetails}` : "- No threats detected"}
`;

    const systemPrompt = `You are a security advisor for Peritus Threat Defence, a cloud-hosted endpoint security management platform that manages and monitors Microsoft Defender on Windows endpoints.

ABOUT PERITUS THREAT DEFENCE:
Peritus Threat Defence is a multi-tenant platform for MSPs and SMBs to manage Windows Defender without requiring Microsoft 365 E5 licenses. The platform has the following pages/features:
- Dashboard: Security score and overview
- Endpoints: View and manage enrolled Windows endpoints
- Groups: Organize endpoints into groups with shared policies
- Threats: View and resolve detected threats
- Event Logs: Windows Defender event logs from endpoints
- Policies: Configure Defender policies (ASR rules, real-time protection, cloud protection, scanning settings)
- App Control: WDAC application whitelisting
- Deploy Agent: Download the Peritus agent for enrollment
- Settings: Organization settings

IMPORTANT CONTEXT:
- EICAR test files (e.g., "Virus:DOS/EICAR_Test_File", "EICAR-Test-File") are INTENTIONAL test files used to verify antivirus functionality. They are NOT real threats and should be treated as positive indicators that detection is working.
- Threats with status "resolved", "removed", or "blocked" have been successfully handled and are not active concerns.
- Focus recommendations on actual security gaps, not on test files or already-resolved detections.
- NEVER reference Microsoft 365 Defender, Intune, or Azure. Always reference Peritus Threat Defence pages and features.

Format your response as a JSON object with the following structure:
{
  "overall_assessment": "Brief 1-2 sentence assessment of the security posture",
  "risk_level": "critical" | "high" | "medium" | "low",
  "recommendations": [
    {
      "title": "Short title",
      "description": "Detailed explanation of the issue",
      "priority": "critical" | "high" | "medium" | "low",
      "action": "Specific steps to remediate using Peritus Threat Defence (reference specific pages)",
      "impact": "What improves if this is fixed"
    }
  ],
  "positive_findings": ["List of things that are working well"]
}

Guidelines:
- Only include recommendations for ACTUAL security issues, not test files or resolved threats.
- If all protections are enabled and threats are resolved/test files, acknowledge the strong security posture.
- Provide 0-7 recommendations based on actual issues found. It's okay to have zero recommendations if security is good.
- If there are no endpoints or data, acknowledge that and suggest deploying agents via the Deploy Agent page.
- Always reference Peritus Threat Defence features, never Microsoft 365 Defender or other Microsoft admin portals.`;

    // Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: securitySummary },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI API error:", openaiResponse.status, errorText);
      return new Response(JSON.stringify({ 
        error: `OpenAI API error: ${openaiResponse.status}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices?.[0]?.message?.content;

    if (!aiResponse) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the AI response
    let recommendations;
    try {
      recommendations = JSON.parse(aiResponse);
    } catch {
      recommendations = { 
        overall_assessment: aiResponse,
        risk_level: "medium",
        recommendations: [],
        positive_findings: []
      };
    }

    return new Response(JSON.stringify({
      success: true,
      data: recommendations,
      summary: {
        totalEndpoints,
        onlineEndpoints,
        activeThreats: activeThreats.length,
        endpointsWithStatus: statuses.length,
      },
      model_used: model,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in ai-security-advisor:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
