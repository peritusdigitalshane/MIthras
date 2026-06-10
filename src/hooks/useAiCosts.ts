import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface AiModelRate {
  model: string;
  usd_per_million_input:  number;
  usd_per_million_output: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiCostBudget {
  id: string;
  organization_id: string | null;
  month_budget_cents: number;
  alert_at_80_pct:  boolean;
  alert_at_100_pct: boolean;
  notify_email: string | null;
  current_month: string;
  alert_80_sent_at:  string | null;
  alert_100_sent_at: string | null;
}

export interface AiCostBreakdownRow {
  feature: string;
  organization_id: string | null;
  organization_name: string | null;
  call_count: number;
  success_count: number;
  error_count: number;
  total_cost_microcents: number;
  total_cost_cents: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  avg_latency_ms: number | null;
}

export interface AiMonthSpendRow {
  budget_id: string;
  scope_org_id: string | null;
  scope_org_name: string;
  spent_microcents: number;
  spent_cents: number;
  budget_cents: number;
  pct_of_budget: number | null;
  alert_at_80_pct:  boolean;
  alert_at_100_pct: boolean;
  alert_80_sent_at:  string | null;
  alert_100_sent_at: string | null;
  current_month: string;
}

export interface AiRecentCall {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  feature: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_microcents: number;
  cost_cents: number;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────

export function useAiModelRates() {
  return useQuery({
    queryKey: ["ai-model-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_rates")
        .select("*")
        .order("model");
      if (error) throw error;
      return (data ?? []) as AiModelRate[];
    },
    staleTime: 30_000,
  });
}

export function useAiCostBudgets() {
  return useQuery({
    queryKey: ["ai-cost-budgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_cost_budgets")
        .select("*")
        .order("organization_id", { nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as AiCostBudget[];
    },
    staleTime: 30_000,
  });
}

export function useAiCostBreakdown(startIso: string, endIso: string) {
  return useQuery({
    queryKey: ["ai-cost-breakdown", startIso, endIso],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ai_cost_breakdown" as any, {
        _start: startIso,
        _end:   endIso,
      });
      if (error) throw error;
      return (data ?? []) as AiCostBreakdownRow[];
    },
    staleTime: 60_000,
  });
}

export function useAiMonthSpend(month?: string) {
  return useQuery({
    queryKey: ["ai-month-spend", month ?? "current"],
    queryFn: async () => {
      const args: Record<string, unknown> = {};
      if (month) args._month = month;
      const { data, error } = await supabase.rpc("get_ai_month_spend" as any, args);
      if (error) throw error;
      return (data ?? []) as AiMonthSpendRow[];
    },
    staleTime: 30_000,
  });
}

export function useAiRecentCalls(limit = 50) {
  return useQuery({
    queryKey: ["ai-recent-calls", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ai_recent_calls" as any, { _limit: limit });
      if (error) throw error;
      return (data ?? []) as AiRecentCall[];
    },
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Writes
// ──────────────────────────────────────────────────────────────────────

export function useUpdateAiModelRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { model: string; usd_per_million_input: number; usd_per_million_output: number; notes?: string | null; }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("ai_model_rates")
        .update({
          usd_per_million_input:  payload.usd_per_million_input,
          usd_per_million_output: payload.usd_per_million_output,
          notes: payload.notes ?? null,
          updated_by: u?.user?.id ?? null,
        })
        .eq("model", payload.model);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-model-rates"] }),
  });
}

export function useInsertAiModelRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { model: string; usd_per_million_input: number; usd_per_million_output: number; notes?: string | null; }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("ai_model_rates").insert({
        model: payload.model,
        usd_per_million_input:  payload.usd_per_million_input,
        usd_per_million_output: payload.usd_per_million_output,
        notes: payload.notes ?? null,
        updated_by: u?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-model-rates"] }),
  });
}

export function useUpsertAiCostBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string; organization_id: string | null; month_budget_cents: number; alert_at_80_pct: boolean; alert_at_100_pct: boolean; notify_email?: string | null; }) => {
      if (payload.id) {
        const { error } = await supabase.from("ai_cost_budgets").update({
          month_budget_cents: payload.month_budget_cents,
          alert_at_80_pct:    payload.alert_at_80_pct,
          alert_at_100_pct:   payload.alert_at_100_pct,
          notify_email:       payload.notify_email ?? null,
        }).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ai_cost_budgets").insert({
          organization_id:    payload.organization_id,
          month_budget_cents: payload.month_budget_cents,
          alert_at_80_pct:    payload.alert_at_80_pct,
          alert_at_100_pct:   payload.alert_at_100_pct,
          notify_email:       payload.notify_email ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-cost-budgets"] });
      qc.invalidateQueries({ queryKey: ["ai-month-spend"] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

export function formatUsd(microcents: number, decimals = 2): string {
  // 1 cent = 1000 µ¢; 100 cents = 1 USD; 100_000 µ¢ = 1 USD
  return `$${(microcents / 100_000).toFixed(decimals)}`;
}

export function formatCentsUsd(cents: number, decimals = 2): string {
  return `$${(cents / 100).toFixed(decimals)}`;
}
