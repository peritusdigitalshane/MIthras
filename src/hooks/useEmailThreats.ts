import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export type EmailClassification = "phishing" | "bec" | "spam" | "malware" | "suspicious" | "legitimate";
export type EmailAction = "none" | "flagged" | "user_warned" | "quarantined" | "released";

export interface EmailThreat {
  id: string;
  organization_id: string;
  graph_message_id: string;
  internet_message_id: string | null;
  recipient_email: string;
  sender_email: string | null;
  sender_domain: string | null;
  sender_display_name: string | null;
  subject: string | null;
  received_at: string;
  classification: EmailClassification;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  ai_reasoning: string | null;
  iocs: Record<string, unknown>;
  action_taken: EmailAction;
  reviewed_at: string | null;
  reviewer_verdict: string | null;
  created_at: string;
  // Cross-mailbox sweep markers. campaign_swept_at is set on the origin
  // AND every sibling once a quarantine action triggered the sweep.
  // parent_threat_id is set on siblings only (NULL on origin + solo).
  parent_threat_id: string | null;
  campaign_swept_at: string | null;
}

export interface EmailSweepRun {
  id: string;
  organization_id: string;
  recipient_email: string | null;
  last_message_received_at: string | null;
  messages_scanned: number;
  threats_detected: number;
  last_swept_at: string;
  last_error: string | null;
}

export function useEmailThreats(opts?: { limit?: number; classification?: EmailClassification }) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  const limit = opts?.limit ?? 100;
  return useQuery({
    queryKey: ["email-threats", orgId, opts?.classification, limit],
    enabled: !!orgId,
    queryFn: async (): Promise<EmailThreat[]> => {
      if (!orgId) return [];
      let q = supabase
        .from("email_threats")
        .select("*")
        .eq("organization_id", orgId)
        .order("received_at", { ascending: false })
        .limit(limit);
      if (opts?.classification) q = q.eq("classification", opts.classification);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EmailThreat[];
    },
  });
}

export interface EmailSecurityActivity {
  messages_scanned:          number;
  messages_classified_by_ai: number;
  messages_matched_by_rule:  number;
  threats_detected:          number;
  mailboxes_monitored:       number;   // peak distinct mailbox count seen in window
  days_with_activity:        number;   // how many days within the window saw any sweep
}

export function useEmailSecurityActivity(opts?: { days?: number }) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  const days = opts?.days ?? 30;
  return useQuery({
    queryKey: ["email-security-activity", orgId, days],
    enabled: !!orgId,
    queryFn: async (): Promise<EmailSecurityActivity> => {
      if (!orgId) {
        return { messages_scanned: 0, messages_classified_by_ai: 0, messages_matched_by_rule: 0, threats_detected: 0, mailboxes_monitored: 0, days_with_activity: 0 };
      }
      const sinceDate = new Date();
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      const sinceIso = sinceDate.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("email_sweep_metrics")
        .select("messages_scanned, messages_classified_by_ai, messages_matched_by_rule, threats_detected, mailboxes_swept")
        .eq("organization_id", orgId)
        .gte("sweep_date", sinceIso);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ messages_scanned: number; messages_classified_by_ai: number; messages_matched_by_rule: number; threats_detected: number; mailboxes_swept: number }>;
      let scanned = 0, ai = 0, rule = 0, threats = 0, mailboxesPeak = 0;
      for (const r of rows) {
        scanned += Number(r.messages_scanned ?? 0);
        ai      += Number(r.messages_classified_by_ai ?? 0);
        rule    += Number(r.messages_matched_by_rule ?? 0);
        threats += Number(r.threats_detected ?? 0);
        mailboxesPeak = Math.max(mailboxesPeak, Number(r.mailboxes_swept ?? 0));
      }
      return {
        messages_scanned:          scanned,
        messages_classified_by_ai: ai,
        messages_matched_by_rule:  rule,
        threats_detected:          threats,
        mailboxes_monitored:       mailboxesPeak,
        days_with_activity:        rows.length,
      };
    },
  });
}

export function useEmailSweepStatus() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["email-sweep-runs", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<EmailSweepRun[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("email_sweep_runs")
        .select("*")
        .eq("organization_id", orgId)
        .order("last_swept_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as EmailSweepRun[];
    },
  });
}

// Operator actions: quarantine / warn / release. Hits the m365-email-action
// edge function with the user's JWT — the function re-validates admin rights
// and talks Graph with the tenant's stored access token.
//
// Accepts either { threatId } for a single-row action or { threatIds } for
// bulk. The edge function always returns a per-row results array.
export type EmailActionVariants =
  | { threatId: string;  threatIds?: never; action: "quarantine" | "warn" | "release" }
  | { threatIds: string[]; threatId?: never; action: "quarantine" | "warn" | "release" };

export interface EmailActionResultRow {
  threat_id: string;
  ok: boolean;
  action?: string;
  error?: string;
  // Present only on successful quarantine, when the message had a Message-ID
  // we could match across mailboxes. swept = sibling copies moved to Junk;
  // sibling_count = total siblings discovered (some may have already been
  // quarantined or failed the move).
  campaign?: { swept: number; failed: number; sibling_count: number };
}
export interface EmailActionResponse  { results: EmailActionResultRow[]; summary: { total: number; ok: number; failed: number } }

export function useEmailAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: EmailActionVariants): Promise<EmailActionResponse> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/m365-email-action`;
      const payload: Record<string, unknown> = { action: args.action };
      if ("threatIds" in args && args.threatIds) payload.threat_ids = args.threatIds;
      if ("threatId" in args  && args.threatId)  payload.threat_id  = args.threatId;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body?.error ?? `HTTP ${resp.status}`);
      return body as EmailActionResponse;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["email-threats"] });
      const singular: Record<string, string> = {
        quarantine: "Moved to the recipient's Junk Email folder.",
        warn:       "Warning email sent to the recipient with a release link.",
        release:    "Released back to the recipient's Inbox.",
      };
      const plural: Record<string, string> = {
        quarantine: "messages quarantined",
        warn:       "recipients warned",
        release:    "messages released",
      };
      // Cross-mailbox sweep summary: when quarantining, report how many
      // sibling inboxes also had the same Message-ID quarantined. Only
      // surfaces on quarantine — release intentionally never sweeps.
      const totalSwept = data.results.reduce((sum, r) => sum + (r.campaign?.swept ?? 0), 0);
      const campaignSuffix = (vars.action === "quarantine" && totalSwept > 0)
        ? ` Also swept ${totalSwept} sibling ${totalSwept === 1 ? "inbox" : "inboxes"} (same Message-ID).`
        : "";

      const isBulk = "threatIds" in vars && (vars.threatIds?.length ?? 0) > 1;
      if (isBulk) {
        const failed = data.summary.failed;
        const description = (failed === 0
          ? `${data.summary.ok} ${plural[vars.action]}.`
          : `${data.summary.ok} succeeded, ${failed} failed.`) + campaignSuffix;
        toast({
          title: "Bulk action complete",
          description,
          variant: failed > 0 ? "destructive" : undefined,
        });
      } else {
        const row = data.results[0];
        if (row && !row.ok) {
          toast({ title: "Action failed", description: row.error ?? "Unknown error", variant: "destructive" });
        } else {
          toast({ title: "Action complete", description: singular[vars.action] + campaignSuffix });
        }
      }
    },
    onError: (e: any) => {
      toast({ title: "Couldn't complete the action", description: e?.message ?? "Unknown error", variant: "destructive" });
    },
  });
}

export function useReviewEmailThreat() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { id: string; verdict: string; action: EmailAction }) => {
      const { error } = await supabase
        .from("email_threats")
        .update({
          reviewer_verdict: args.verdict,
          reviewed_at: new Date().toISOString(),
          action_taken: args.action,
          action_taken_at: new Date().toISOString(),
        } as any)
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-threats"] });
      toast({ title: "Review saved" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save review", description: e?.message ?? "Unknown", variant: "destructive" });
    },
  });
}
