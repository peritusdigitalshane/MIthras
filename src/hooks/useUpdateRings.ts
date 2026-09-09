import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface UpdateRing {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  quality_update_defer_days: number;
  feature_update_defer_days: number;
  install_window_start_local: number;
  install_window_end_local: number;
  critical_only: boolean;
  max_concurrent_installs: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateRingInput {
  name: string;
  description?: string | null;
  quality_update_defer_days: number;
  feature_update_defer_days: number;
  install_window_start_local: number;
  install_window_end_local: number;
  critical_only: boolean;
  max_concurrent_installs: number;
  is_default?: boolean;
}

// Update rings for the currently-active org (super-admin / partner / customer scope).
export function useUpdateRings() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["update-rings", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<UpdateRing[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("update_rings")
        .select("*")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as UpdateRing[];
    },
  });
}

export function useSeedDefaultRings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      const { data, error } = await supabase.rpc("seed_default_update_rings", {
        p_org_id: currentOrganization.id,
      } as any);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["update-rings"] });
      toast({ title: "Default rings created", description: "Pilot, Production, and Critical-only are ready to assign to endpoint groups." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't seed rings",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useUpsertUpdateRing() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (args: { id?: string; values: UpdateRingInput }) => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      // If is_default = true, unset any existing default first so the unique
      // partial index never trips.
      if (args.values.is_default) {
        const { error: clearErr } = await supabase
          .from("update_rings")
          .update({ is_default: false } as any)
          .eq("organization_id", currentOrganization.id)
          .eq("is_default", true);
        if (clearErr) throw clearErr;
      }

      if (args.id) {
        const { error } = await supabase
          .from("update_rings")
          .update(args.values as any)
          .eq("id", args.id);
        if (error) throw error;
        return args.id;
      } else {
        const { data, error } = await supabase
          .from("update_rings")
          .insert({ ...args.values, organization_id: currentOrganization.id } as any)
          .select("id")
          .single();
        if (error) throw error;
        return (data as any).id as string;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["update-rings"] });
      toast({ title: "Ring saved" });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save ring",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useDeleteUpdateRing() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("update_rings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["update-rings"] });
      qc.invalidateQueries({ queryKey: ["endpoint-groups"] });
      toast({ title: "Ring deleted", description: "Any groups using it are now unassigned." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't delete ring",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });
}
