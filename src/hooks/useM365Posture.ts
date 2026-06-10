import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PostureStatus = "pass" | "warn" | "fail" | "error" | "skipped";

export interface PostureControl {
  control_id:        string;
  category:          "identity" | "email" | "data" | "apps" | "governance";
  title:             string;
  description:       string;
  weight:            number;
  cis_reference:     string | null;
  remediation_url:   string | null;
  remediation_steps: Array<{ step: string }>;
  impact_if_failed:  string;
}

export interface PostureFinding {
  id:            string;
  snapshot_id:   string;
  control_id:    string;
  status:        PostureStatus;
  score:         number;
  details:       Record<string, unknown>;
  error_message: string | null;
}

export interface PostureSnapshot {
  id:                 string;
  organization_id:    string;
  m365_tenant_id:     string;
  scanned_at:         string;
  overall_score:      number | null;
  secure_score:       number | null;
  secure_score_max:   number | null;
  pass_count:         number;
  warn_count:         number;
  fail_count:         number;
  error_count:        number;
  scan_duration_ms:   number | null;
  scan_error:         string | null;
  triggered_by:       string | null;
}

export interface PostureAdvicePayload {
  summary:    string;
  risk_level: "critical" | "high" | "medium" | "low";
  top_actions: Array<{
    control_id:  string;
    why_now:     string;
    steps:       string[];
    est_minutes: number;
  }>;
  shoutouts: string[];
}

export interface PostureAdvice {
  id:           string;
  snapshot_id:  string;
  generated_at: string;
  model:        string | null;
  cost_cents:   number | null;
  latency_ms:   number | null;
  payload:      PostureAdvicePayload;
}

export interface LatestPosture {
  snapshot: PostureSnapshot | null;
  findings: Array<{ finding: PostureFinding; control: PostureControl }>;
  advice:   PostureAdvice | null;
}

export function useLatestM365Posture(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["m365-posture-latest", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc("get_latest_m365_posture" as any, { _organization_id: orgId });
      if (error) throw error;
      return data as unknown as LatestPosture;
    },
    staleTime: 60_000,
  });
}

export function useM365PostureTrend(orgId: string | null | undefined, days = 30) {
  return useQuery({
    queryKey: ["m365-posture-trend", orgId, days],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc("get_m365_posture_trend" as any, { _organization_id: orgId, _days: days });
      if (error) throw error;
      return (data ?? []) as Array<{ scanned_at: string; overall_score: number | null; secure_score: number | null; fail_count: number }>;
    },
    staleTime: 5 * 60_000,
  });
}

export function useRunPostureScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const r = await fetch(`${supabaseUrl}/functions/v1/m365-posture-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j as { snapshot_id: string; overall_score: number; pass_count: number; warn_count: number; fail_count: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["m365-posture-latest"] });
      qc.invalidateQueries({ queryKey: ["m365-posture-trend"] });
    },
  });
}

export function useGeneratePostureAdvice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const r = await fetch(`${supabaseUrl}/functions/v1/m365-posture-advisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ snapshot_id: snapshotId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j as { advice_id: string; payload: PostureAdvicePayload };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["m365-posture-latest"] });
    },
  });
}

// Convenience: load the user's first M365 tenant for the active org. The
// posture page renders for one tenant at a time; users with multiple
// tenants pick from a dropdown (v2).
export function useM365TenantForOrg(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["m365-tenant-for-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("m365_tenants" as any)
        .select("id, tenant_id, tenant_display_name, tenant_domain, consent_state, last_poll_at, last_poll_error")
        .eq("organization_id", orgId)
        .eq("consent_state", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string; tenant_id: string; tenant_display_name: string | null;
        tenant_domain: string | null; consent_state: string;
        last_poll_at: string | null; last_poll_error: string | null;
      } | null;
    },
    staleTime: 60_000,
  });
}
