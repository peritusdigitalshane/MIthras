import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";

export interface RouterEnrollmentToken {
  id: string;
  organization_id: string;
  /**
   * SHA-256 of the enrolment token. The plaintext is returned exactly once,
   * by useCreateRouterEnrollmentToken, and is never persisted — so it cannot
   * be listed, re-displayed, or recovered after the creation dialog closes.
   * Rendering code must treat a token as write-once.
   */
  token_hash: string;
  label: string;
  is_active: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
}

export function useRouterEnrollmentTokens() {
  const { currentOrganization } = useTenant();
  return useQuery({
    queryKey: ["router-enrollment-tokens", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("router_enrollment_tokens")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RouterEnrollmentToken[];
    },
  });
}

export function useCreateRouterEnrollmentToken() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (params: { label: string; max_uses?: number; expires_at?: string }) => {
      // Minting moved server-side (mint_router_enrollment_token). The table no
      // longer carries a plaintext `token` column or a default that generates
      // one, so a direct insert cannot produce a usable token. The RPC returns
      // the plaintext exactly once — this is the only moment it exists outside
      // the router that will use it.
      const { data, error } = await supabase.rpc("mint_router_enrollment_token", {
        p_organization_id: currentOrganization!.id,
        p_label: params.label,
        p_max_uses: params.max_uses ?? null,
        p_expires_at: params.expires_at ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.plaintext_token) throw new Error("Token minting returned no token");
      return { id: row.token_id as string, plaintext_token: row.plaintext_token as string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-enrollment-tokens"] });
      toast.success("Enrollment token created — copy it now, it can't be shown again");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteRouterEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("router_enrollment_tokens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["router-enrollment-tokens"] });
      toast.success("Token deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
