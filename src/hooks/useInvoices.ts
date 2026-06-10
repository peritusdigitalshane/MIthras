import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Invoice {
  id: string;
  invoice_number: string;
  issuer_org_id: string;
  bill_to_org_id: string;
  period_start: string;
  period_end: string;
  issued_at: string;
  due_date: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency_code: string;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  sent_at: string | null;
  paid_at: string | null;
  paid_via: string | null;
  notes: string | null;
  bill_to_name?: string;
  issuer_name?: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  org_id: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  position: number;
}

// All invoices the current user can SELECT (super-admin = everything; org
// admins = invoices billed TO their org or issued BY their org).
export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices" as any)
        .select("*, bill_to:bill_to_org_id(name), issuer:issuer_org_id(name)" as any)
        .order("issued_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        ...r,
        bill_to_name: r.bill_to?.name,
        issuer_name: r.issuer?.name,
      })) as Invoice[];
    },
  });
}

export function useInvoiceLineItems(invoiceId: string | null) {
  return useQuery({
    queryKey: ["invoice-line-items", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_line_items" as any)
        .select("*")
        .eq("invoice_id", invoiceId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as InvoiceLineItem[];
    },
  });
}

// Generate (or refresh draft) a Peritus invoice for one bill-to org.
// Super-admin only — invokes the SECURITY DEFINER RPC.
export function useGenerateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, periodStart, periodEnd, dueOffsetDays = 14 }: {
      orgId: string;
      periodStart: string; // YYYY-MM-DD
      periodEnd: string;   // YYYY-MM-DD
      dueOffsetDays?: number;
    }) => {
      const { data, error } = await supabase.rpc("generate_peritus_invoice" as any, {
        _bill_to_org_id: orgId,
        _period_start: periodStart,
        _period_end: periodEnd,
        _due_offset_days: dueOffsetDays,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

// Trigger the send-invoice-email edge function. On 200 the invoice is
// already marked 'sent' server-side, so we just invalidate.
export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const r = await fetch(`${supabaseUrl}/functions/v1/send-invoice-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.details ?? json.error ?? `HTTP ${r.status}`);
      return json as { ok: true; sent_to: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useUpdateInvoiceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, status, paidVia }: {
      invoiceId: string;
      status: Invoice["status"];
      paidVia?: string | null;
    }) => {
      const patch: any = { status, updated_at: new Date().toISOString() };
      if (status === "sent")  patch.sent_at = new Date().toISOString();
      if (status === "paid") {
        patch.paid_at = new Date().toISOString();
        if (paidVia) patch.paid_via = paidVia;
      }
      const { error } = await supabase.from("invoices" as any).update(patch).eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}
