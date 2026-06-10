import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FindingSeverity = "info" | "warning" | "error" | "critical";
export type FindingStatus = "open" | "resolved" | "accepted_risk";

export interface AuditFinding {
  id: string;
  site_id: string;
  organization_id: string;
  finding_key: string;
  category: string;
  severity: FindingSeverity;
  title: string;
  description: string | null;
  recommendation: string | null;
  evidence: any;
  status: FindingStatus;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface ProtectionSettings {
  disable_file_edit: boolean;
  force_ssl_admin: boolean;
  disable_xmlrpc: boolean;
  hide_wp_version: boolean;
  block_user_enumeration: boolean;
  block_php_in_uploads: boolean;
  security_headers: boolean;
  disable_pingbacks: boolean;
  limit_login_attempts: boolean;
  login_lockout_threshold: number;
  login_lockout_minutes: number;
  require_strong_passwords: boolean;
  disable_app_passwords: boolean;
  auto_update_minor_core: boolean;
  auto_update_plugins: boolean;
  auto_update_themes: boolean;
  audit_interval_hours: number;
  scan_uploads_for_php: boolean;
  scan_file_integrity: boolean;
  watch_admin_creation: boolean;
}

export function useSiteFindings(siteId: string | null) {
  return useQuery({
    queryKey: ["site-findings", siteId],
    enabled: !!siteId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<AuditFinding[]> => {
      const { data, error } = await supabase
        .from("site_audit_findings")
        .select("*")
        .eq("site_id", siteId!)
        .order("status", { ascending: true })
        .order("severity", { ascending: true })
        .order("last_seen_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditFinding[];
    },
  });
}

export function useUpdateFindingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: FindingStatus }) => {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.status === "resolved" || args.status === "accepted_risk") {
        patch.resolved_at = new Date().toISOString();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) patch.resolved_by = user.id;
      } else {
        patch.resolved_at = null;
      }
      const { error } = await supabase.from("site_audit_findings").update(patch).eq("id", args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["site-findings"] }),
  });
}

export function useSiteProtection(siteId: string | null) {
  return useQuery({
    queryKey: ["site-protection", siteId],
    enabled: !!siteId,
    queryFn: async (): Promise<{ settings: ProtectionSettings; settings_version: number } | null> => {
      const { data, error } = await supabase
        .from("site_protection_settings")
        .select("settings, settings_version")
        .eq("site_id", siteId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as any;
    },
  });
}

export function useUpdateSiteProtection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { siteId: string; settings: Partial<ProtectionSettings> }) => {
      // Fetch current then merge; bump settings_version so the plugin can detect changes.
      const { data: existing } = await supabase
        .from("site_protection_settings")
        .select("settings, settings_version, organization_id")
        .eq("site_id", args.siteId)
        .maybeSingle();
      if (!existing) throw new Error("Site protection row missing — site may not be enrolled.");
      const merged = { ...(existing.settings as object), ...args.settings };
      const { error } = await supabase
        .from("site_protection_settings")
        .update({ settings: merged, settings_version: (existing.settings_version ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq("site_id", args.siteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["site-protection", args.siteId] });
    },
  });
}

export function useGenerateSiteReport() {
  return useMutation({
    mutationFn: async (args: { siteId: string; organizationId: string; kind: "weekly" | "monthly" | "ad_hoc"; periodStart: string; periodEnd: string }) => {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-customer-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          organization_id: args.organizationId,
          site_id:         args.siteId,
          kind:            args.kind,
          period_start:    args.periodStart,
          period_end:      args.periodEnd,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      return json;
    },
  });
}
