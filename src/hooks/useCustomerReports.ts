import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface CustomerReport {
  id: string;
  organization_id: string;
  kind: string;
  period_start: string;
  period_end: string;
  status: "queued" | "generating" | "ready" | "failed" | "sent";
  storage_path: string | null;
  pdf_storage_path: string | null;
  summary: Record<string, unknown> | null;
  generated_at: string | null;
  sent_at: string | null;
  delivered_to: string[] | null;
  last_send_error: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ReportRecipient {
  id: string;
  organization_id: string;
  email: string;
  name: string | null;
  role_label: string | null;
  monthly: boolean;
  weekly: boolean;
  quarterly: boolean;
  created_at: string;
  updated_at: string;
}

export function useCustomerReports() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  // Require an org selection. The previous `enabled: !!orgId || isSuperAdmin`
  // let super-admins without a selected org pull up to 50 rows of mixed-
  // tenant reports with no Organization column to distinguish them - the
  // page rendered as if it were a single-org view. Force the operator to
  // pick a customer before any rows render. Super-admins still see every
  // org's reports via RLS once they switch tenant.
  return useQuery({
    queryKey: ["customer-reports", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<CustomerReport[]> => {
      const { data, error } = await supabase
        .from("customer_reports")
        .select("*")
        .eq("organization_id", orgId!)
        .order("period_start", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CustomerReport[];
    },
  });
}

export async function getReportSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("customer-reports")
    .createSignedUrl(storagePath, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function useReportRecipients() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  return useQuery({
    queryKey: ["org-report-recipients", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ReportRecipient[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("org_report_recipients")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ReportRecipient[];
    },
  });
}

export function useAddReportRecipient() {
  const qc = useQueryClient();
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      name?: string;
      role_label?: string;
      monthly?: boolean;
      weekly?: boolean;
      quarterly?: boolean;
    }) => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      const { data, error } = await supabase
        .from("org_report_recipients")
        .insert({
          organization_id: currentOrganization.id,
          email: input.email.trim().toLowerCase(),
          name: input.name?.trim() || null,
          role_label: input.role_label?.trim() || null,
          monthly: input.monthly ?? true,
          weekly: input.weekly ?? false,
          quarterly: input.quarterly ?? false,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ReportRecipient;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-report-recipients"] });
      toast({ title: "Recipient added" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to add recipient", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateReportRecipient() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<ReportRecipient>) => {
      const { error } = await supabase
        .from("org_report_recipients")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-report-recipients"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to update recipient", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteReportRecipient() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("org_report_recipients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-report-recipients"] });
      toast({ title: "Recipient removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to remove recipient", description: e.message, variant: "destructive" }),
  });
}

export function useSendReport() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (reportId: string) => {
      const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/send-customer-report`;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ report_id: reportId }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      return body as { ok: true; sent_to: string[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["customer-reports"] });
      toast({
        title: "Report sent",
        description: `Delivered to ${data.sent_to.length} recipient${data.sent_to.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });
}
