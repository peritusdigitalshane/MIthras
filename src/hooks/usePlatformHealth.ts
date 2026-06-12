import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// Types — mirror public.platform_health_findings + platform_health_runs
// ──────────────────────────────────────────────────────────────────────

export type HealthCategory =
  | "cron" | "edge_function" | "database" | "agent_fleet"
  | "ai_pipeline" | "budget" | "integration" | "security" | "other";

export type HealthSeverity =
  "critical" | "high" | "medium" | "low" | "info" | "unknown";

export type HealthStatus =
  "open" | "acknowledged" | "fixed" | "dismissed" | "auto_resolved";

export interface PlatformHealthFinding {
  id: string;
  finding_key: string;
  category: HealthCategory;
  severity: HealthSeverity;
  title: string;
  description: string | null;
  evidence: Record<string, unknown>;
  triage_verdict: string | null;
  triage_reasoning: string | null;
  recommended_fix: string | null;
  triage_model: string | null;
  triage_cost_microcents: number;
  status: HealthStatus;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface PlatformHealthRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  signals_collected: number;
  findings_opened: number;
  findings_updated: number;
  findings_resolved: number;
  status: "running" | "succeeded" | "failed" | "partial";
  error_message: string | null;
  triage_cost_microcents: number;
}

// ──────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────

export function usePlatformHealthFindings() {
  return useQuery({
    queryKey: ["platform-health-findings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_health_findings" as any)
        .select("*")
        .order("status", { ascending: true }) // open first
        .order("severity", { ascending: true })
        .order("last_seen", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PlatformHealthFinding[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function usePlatformHealthRuns(limit = 20) {
  return useQuery({
    queryKey: ["platform-health-runs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_health_runs" as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as PlatformHealthRun[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Writes
// ──────────────────────────────────────────────────────────────────────

export function useRunPlatformHealthScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-platform-health-scan", {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-health-findings"] });
      qc.invalidateQueries({ queryKey: ["platform-health-runs"] });
    },
  });
}

export function useUpdateFindingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; status: HealthStatus; note?: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const update: Record<string, unknown> = { status: payload.status };
      if (payload.status === "fixed" || payload.status === "dismissed") {
        update.resolved_at = new Date().toISOString();
        update.resolved_by = u.user?.id ?? null;
        if (payload.note) update.resolution_note = payload.note;
      }
      const { error } = await supabase
        .from("platform_health_findings" as any)
        .update(update)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-health-findings"] });
    },
  });
}
