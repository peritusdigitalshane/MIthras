import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, FileText, Download, Save } from "lucide-react";
import { useGenerateReportData, useSaveReport, ReportType, SectionVisibility } from "@/hooks/useReports";
import { useTenant } from "@/contexts/TenantContext";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { ReportDocument } from "./ReportDocument";

interface ReportGeneratorProps {
  reportType: ReportType;
  onClose: () => void;
}

const monthlySections = [
  { key: "executiveSummary", label: "Executive Summary" },
  { key: "securityScore", label: "Security Score" },
  { key: "threatSummary", label: "Threat Summary" },
  { key: "threatDetails", label: "Threat Details" },
  { key: "complianceOverview", label: "Compliance Overview" },
  { key: "complianceDetails", label: "Compliance Details" },
  { key: "endpointInventory", label: "Endpoint Inventory" },
  { key: "essential8", label: "Essential Eight Alignment" },
  { key: "recommendations", label: "Recommendations" },
];

const insuranceSections = [
  { key: "executiveSummary", label: "Executive Summary" },
  { key: "securityScore", label: "Security Score" },
  { key: "securityControls", label: "Security Controls" },
  { key: "coverageSummary", label: "Coverage Summary" },
  { key: "complianceOverview", label: "Compliance Status" },
  { key: "threatSummary", label: "Threat History" },
  { key: "essential8", label: "Essential Eight Alignment" },
  { key: "recommendations", label: "Improvement Areas" },
];

export function ReportGenerator({ reportType, onClose }: ReportGeneratorProps) {
  const { currentOrganization } = useTenant();
  const { generateReportData, getDefaultVisibility } = useGenerateReportData();
  const saveReport = useSaveReport();

  const lastMonth = subMonths(new Date(), 1);
  const defaultStart = format(startOfMonth(lastMonth), "yyyy-MM-dd");
  const defaultEnd = format(endOfMonth(lastMonth), "yyyy-MM-dd");

  const [title, setTitle] = useState(
    reportType === "monthly_security"
      ? `${currentOrganization?.name || "Security"} Monthly Report - ${format(lastMonth, "MMMM yyyy")}`
      : `${currentOrganization?.name || "Security"} Cyber Insurance Report - ${format(new Date(), "MMMM yyyy")}`
  );
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [visibility, setVisibility] = useState<SectionVisibility>(getDefaultVisibility(reportType));
  const [showPreview, setShowPreview] = useState(false);

  const reportData = generateReportData(reportType);
  reportData.reportPeriod = `${format(new Date(periodStart), "MMMM d, yyyy")} - ${format(new Date(periodEnd), "MMMM d, yyyy")}`;

  const sections = reportType === "monthly_security" ? monthlySections : insuranceSections;

  const toggleSection = (key: string) => {
    setVisibility(prev => ({
      ...prev,
      [key]: !prev[key as keyof SectionVisibility],
    }));
  };

  const handleSave = async () => {
    try {
      await saveReport.mutateAsync({
        report_type: reportType,
        report_title: title,
        report_period_start: periodStart,
        report_period_end: periodEnd,
        report_data: reportData,
        section_visibility: visibility,
      });
      toast({ title: "Report saved successfully" });
      onClose();
    } catch (error) {
      toast({ title: "Failed to save report", variant: "destructive" });
    }
  };

  const handleExportPdf = () => {
    const err = printReport({
      contentElementId: "report-preview-content",
      title,
    });
    if (err === "no_content") {
      toast({ title: "Please preview the report first", variant: "destructive" });
      setShowPreview(true);
    } else if (err === "popup_blocked") {
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
              <h1 className="text-2xl font-bold">
                {reportType === "monthly_security" ? "Monthly Security Report" : "Cyber Insurance Report"}
              </h1>
              <p className="text-muted-foreground">Configure and preview your report</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSave} disabled={saveReport.isPending}>
              <Save className="mr-2 h-4 w-4" />
              Save Report
            </Button>
            <Button onClick={handleExportPdf}>
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Report Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="start">Period Start</Label>
                    <Input
                      id="start"
                      type="date"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end">Period End</Label>
                    <Input
                      id="end"
                      type="date"
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sections</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sections.map(section => (
                  <div key={section.key} className="flex items-center justify-between">
                    <Label htmlFor={section.key} className="cursor-pointer">
                      {section.label}
                    </Label>
                    <Switch
                      id={section.key}
                      checked={visibility[section.key as keyof SectionVisibility] ?? true}
                      onCheckedChange={() => toggleSection(section.key)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => setShowPreview(!showPreview)}
            >
              <FileText className="mr-2 h-4 w-4" />
              {showPreview ? "Hide Preview" : "Show Preview"}
            </Button>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-2">
            {showPreview ? (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="bg-white p-8 min-h-[600px]" id="report-preview-content">
                    <ReportDocument
                      reportType={reportType}
                      title={title}
                      reportData={reportData}
                      visibility={visibility}
                    />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Click "Show Preview" to see your report</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
