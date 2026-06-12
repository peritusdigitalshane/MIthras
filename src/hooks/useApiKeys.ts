import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ApiKey {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

export const AVAILABLE_SCOPES = [
  { value: "endpoints:read",  label: "endpoints:read",  description: "List and read endpoint data" },
  { value: "incidents:read",  label: "incidents:read",  description: "Read incidents and verdicts" },
  { value: "threats:read",    label: "threats:read",    description: "Read threat detections" },
  { value: "reports:read",    label: "reports:read",    description: "Read monthly customer reports" },
  { value: "customers:read",  label: "customers:read",  description: "List customers (reseller/distributor)" },
  { value: "customers:write", label: "customers:write", description: "Create customers — onboarding" },
  { value: "agent:enroll",    label: "agent:enroll",    description: "Issue agent installation tokens" },
];

export function useApiKeys(orgId: string | null) {
  return useQuery({
    queryKey: ["api-keys", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys" as any)
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ApiKey[];
    },
    staleTime: 15_000,
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `mit_live_${b64}`;
}

export interface CreatedApiKey {
  row: ApiKey;
  rawToken: string;
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organization_id: string;
      name: string;
      scopes: string[];
      expires_in_days?: number | null;
    }): Promise<CreatedApiKey> => {
      const rawToken = randomToken();
      const keyPrefix = rawToken.slice(0, 12);
      const keyHash = await sha256Hex(rawToken);
      const expiresAt =
        input.expires_in_days != null
          ? new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString()
          : null;
      const { data, error } = await supabase.rpc("create_api_key" as any, {
        p_organization_id: input.organization_id,
        p_name:            input.name,
        p_key_prefix:      keyPrefix,
        p_key_hash:        keyHash,
        p_scopes:          input.scopes,
        p_expires_at:      expiresAt,
      });
      if (error) throw error;
      return { row: data as unknown as ApiKey, rawToken };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("revoke_api_key" as any, { p_key_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}
