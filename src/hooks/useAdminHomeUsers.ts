import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HomeUsersTotals {
  total_home_users:     number;
  active_subscriptions: number;
  past_due:             number;
  canceled:             number;
  estimated_mrr_cents:  number;
  endpoints_total:      number;
  endpoints_online:     number;
}
export interface HomeUserRow {
  org_id: string;
  org_name: string;
  contact_email: string | null;
  stripe_status: string | null;
  stripe_current_period_end: string | null;
  created_at: string;
  endpoint_count: number;
  last_seen_at: string | null;
}
export interface HomeUsersOverview {
  generated_at: string;
  totals:       HomeUsersTotals;
  rows:         HomeUserRow[];
}

export function useAdminHomeUsers() {
  return useQuery({
    queryKey: ["admin-home-users-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_home_users_overview" as any);
      if (error) throw error;
      return data as unknown as HomeUsersOverview;
    },
    staleTime: 60_000,
  });
}

// Re-send the 3-step home-user welcome email. The edge function pulls a
// fresh magic link, finds the active enrolment token, and dispatches the
// welcome via SMTP. Surfaces the dispatched address in the toast.
export function useResendHomeWelcome() {
  return useMutation({
    mutationFn: async (orgId: string) => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; dispatched_to?: string; error?: string; details?: string }>(
        "admin-resend-home-welcome",
        { body: { org_id: orgId } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ? `${data.error}${data.details ? `: ${data.details}` : ""}` : "Welcome dispatch failed");
      return data;
    },
  });
}
