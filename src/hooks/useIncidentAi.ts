import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IncidentAiAssessment {
  incident_id: string;
  organization_id: string;
  summary: string | null;
  suggested_action: string | null;
  suggested_command: string | null;
  mitre_tags: string[] | null;
  confidence: "high" | "medium" | "low" | null;
  severity_override: "Severe" | "High" | "Moderate" | "Low" | null;
  generated_at: string;
  error_message: string | null;
}

export function useIncidentAssessment(incidentId: string | null) {
  return useQuery({
    queryKey: ["incident-ai", incidentId],
    enabled: !!incidentId,
    queryFn: async (): Promise<IncidentAiAssessment | null> => {
      const { data, error } = await supabase
        .from("incident_ai_assessments")
        .select("*")
        .eq("incident_id", incidentId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as unknown as IncidentAiAssessment | null;
    },
  });
}

export function useTriageIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { incidentId: string; force?: boolean }) => {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const resp = await fetch(`${supabaseUrl}/functions/v1/ai-triage-incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ incident_id: args.incidentId, force: !!args.force }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      return json as { cached: boolean; assessment: IncidentAiAssessment };
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["incident-ai", args.incidentId] });
    },
  });
}
