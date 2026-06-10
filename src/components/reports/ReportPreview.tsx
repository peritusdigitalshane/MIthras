import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { SecurityReport } from "@/hooks/useReports";
import { ReportDocument } from "./ReportDocument";
import { toast } from "@/hooks/use-toast";
import { printReport } from "@/lib/print-report";

interface ReportPreviewProps {
  report: SecurityReport;
  onClose: () => void;
}

export function ReportPreview({ report, onClose }: ReportPreviewProps) {
  const handleExportPdf = () => {
    const err = printReport({
      contentElementId: "report-preview-content",
      title: report.report_title,
    });
    if (err === "popup_blocked") {
      toast({ title: "Please allow popups to export PDF", variant: "destructive" });
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{report.report_title}</h1>
              <p className="text-muted-foreground">
                Generated on {format(new Date(report.generated_at), "d MMM yyyy")}
              </p>
            </div>
          </div>
          <Button onClick={handleExportPdf}>
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-white p-8" id="report-preview-content">
              <ReportDocument
                reportType={report.report_type}
                title={report.report_title}
                reportData={report.report_data}
                visibility={report.section_visibility}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
