import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface MonitoredSite {
  id: string;
  organization_id: string;
  site_url: string;
  name: string | null;
  wp_version: string | null;
  php_version: string | null;
  plugin_count: number;
  active_theme: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_ip: string | null;
  created_at: string;
}

export interface SiteEvent {
  id: string;
  site_id: string;
  event_type: string;
  severity: "info" | "warning" | "error" | "critical";
  actor_user_login: string | null;
  actor_ip: string | null;
  target: string | null;
  summary: string;
  event_time: string;
  raw: any;
}

export interface SiteEnrolmentToken {
  token: string;
  organization_id: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  used_by_site_id: string | null;
  note: string | null;
  created_at: string;
}

// Render-time defence: never trust persisted site_url. site-enroll validates
// http/https at write-time, but a tampered row or future bypass would otherwise
// produce a javascript: / data: link straight into <a href>.
export function safeSiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.toString() : null;
  } catch { return null; }
}

export function siteDisplayHost(raw: string | null | undefined): string {
  const safe = safeSiteUrl(raw);
  if (!safe) return raw ?? "(invalid url)";
  try { return new URL(safe).host; } catch { return safe; }
}

export function useSites() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["monitored-sites", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<MonitoredSite[]> => {
      const { data, error } = await supabase
        .from("monitored_sites")
        .select("*")
        .eq("organization_id", orgId!)
        .order("last_seen_at", { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as MonitoredSite[];
    },
  });
}

export function useSite(siteId: string | null) {
  return useQuery({
    queryKey: ["monitored-site", siteId],
    enabled: !!siteId,
    queryFn: async (): Promise<MonitoredSite | null> => {
      const { data, error } = await supabase
        .from("monitored_sites")
        .select("*")
        .eq("id", siteId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as MonitoredSite | null;
    },
  });
}

export function useSiteEvents(siteId: string | null, limit = 200) {
  return useQuery({
    queryKey: ["site-events", siteId, limit],
    enabled: !!siteId,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SiteEvent[]> => {
      const { data, error } = await supabase
        .from("site_event_logs")
        .select("*")
        .eq("site_id", siteId!)
        .order("event_time", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteEvent[];
    },
  });
}

export function useSiteEnrolmentTokens() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["site-enrolment-tokens", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SiteEnrolmentToken[]> => {
      const { data, error } = await supabase
        .from("site_enrollment_tokens")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteEnrolmentToken[];
    },
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function useCreateSiteEnrolmentToken() {
  const qc = useQueryClient();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (opts: { maxUses?: number; expiresInDays?: number; note?: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization context");
      const expiresAt = new Date(Date.now() + (opts.expiresInDays ?? 14) * 24 * 60 * 60 * 1000).toISOString();
      const token = generateToken();
      const { data, error } = await supabase
        .from("site_enrollment_tokens")
        .insert({
          token,
          organization_id: currentOrganization.id,
          max_uses:        Math.max(1, opts.maxUses ?? 1),
          expires_at:      expiresAt,
          note:            opts.note ?? null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as SiteEnrolmentToken;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-enrolment-tokens"] });
    },
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (siteId: string) => {
      const { error } = await supabase.from("monitored_sites").delete().eq("id", siteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitored-sites"] });
    },
  });
}
