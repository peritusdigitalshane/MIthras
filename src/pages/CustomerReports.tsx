import { MainLayout } from "@/components/layout/MainLayout";
import {
  useCustomerReports,
  getReportSignedUrl,
  useSendReport,
} from "@/hooks/useCustomerReports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, RefreshCw, Send, FileType2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useState } from "react";
import { ReportRecipientsCard } from "@/components/reports/ReportRecipientsCard";

const KIND_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  ad_hoc: "Ad-hoc",
};

const CustomerReports = () => {
  const { toast } = useToast();
  const { currentOrganization, isSuperAdmin } = useTenant();
  const { data: reports, isLoading, refetch } = useCustomerReports();
  const sendReport = useSendReport();
  const [generating, setGenerating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const generateAdHoc = async () => {
    if (!currentOrganization?.id) return;
    setGenerating(true);
    try {
      const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/generate-customer-report`;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 3600 * 1000);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          organization_id: currentOrganization.id,
          kind: "ad_hoc",
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      toast({ title: "Report generated", description: "PDF + HTML stored. Click Download below." });
      refetch();
    } catch (e) {
      toast({
        title: "Generate failed",
        description: e instanceof Error ? e.message : "Unknown",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const open = async (path: string | null) => {
    if (!path) return;
    try {
      const url = await getReportSignedUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown",
        variant: "destructive",
      });
    }
  };

  const send = async (reportId: string) => {
    setSendingId(reportId);
    try {
      await sendReport.mutateAsync(reportId);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" /> Customer reports
            </h1>
            <p className="text-sm text-muted-foreground">
              Monthly PDF reports auto-generate on the 1st of each month and ship to the configured
              recipients. You can also generate ad-hoc reports for any custom period.
            </p>
          </div>
          {(isSuperAdmin || currentOrganization) && (
            <Button
              onClick={generateAdHoc}
              disabled={generating || !currentOrganization}
              className="gap-2"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Generate ad-hoc (last 30 days)
            </Button>
          )}
        </div>

        <ReportRecipientsCard />

        <Card>
          <CardHeader>
            <CardTitle>Available reports</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6">
                <Skeleton className="h-24" />
              </div>
            ) : (reports ?? []).length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-60" />
                <p>No reports yet. Monthly reports are generated on the 1st of each month.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reports ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(r.period_start), "PP")} → {format(new Date(r.period_end), "PP")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.generated_at ? format(new Date(r.generated_at), "PPp") : "—"}
                        {r.sent_at && (
                          <div className="text-[10px] text-green-600 mt-0.5">
                            Sent {format(new Date(r.sent_at), "PPp")}
                          </div>
                        )}
                        {r.last_send_error && (
                          <div className="text-[10px] text-destructive mt-0.5" title={r.last_send_error}>
                            Send error
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "ready" || r.status === "sent"
                              ? "default"
                              : r.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!r.pdf_storage_path}
                            onClick={() => open(r.pdf_storage_path)}
                            className="gap-1.5"
                            title={r.pdf_storage_path ? "Download PDF" : "PDF not available"}
                          >
                            <FileType2 className="h-3.5 w-3.5" /> PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!r.storage_path}
                            onClick={() => open(r.storage_path)}
                            className="gap-1.5"
                          >
                            <Download className="h-3.5 w-3.5" /> HTML
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={!r.pdf_storage_path || sendingId === r.id}
                            onClick={() => send(r.id)}
                            className="gap-1.5"
                          >
                            {sendingId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Send
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default CustomerReports;
