import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Shield, Plus, Calendar, Trash2, Download, Eye } from "lucide-react";
import { useReports, useDeleteReport } from "@/hooks/useReports";
import { QueryError } from "@/components/ui/query-error";
import { ReportGenerator } from "@/components/reports/ReportGenerator";
import { ReportPreview } from "@/components/reports/ReportPreview";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

const Reports = () => {
  const [activeTab, setActiveTab] = useState("generate");
  const [showGenerator, setShowGenerator] = useState(false);
  const [generatorType, setGeneratorType] = useState<"monthly_security" | "cyber_insurance">("monthly_security");
  const [previewReport, setPreviewReport] = useState<string | null>(null);
  const [deleteReportId, setDeleteReportId] = useState<string | null>(null);

  const { data: reports, isLoading, error } = useReports();
  const deleteReport = useDeleteReport();

  const handleNewReport = (type: "monthly_security" | "cyber_insurance") => {
    setGeneratorType(type);
    setShowGenerator(true);
  };

  const handleDelete = async () => {
    if (!deleteReportId) return;
    try {
      await deleteReport.mutateAsync(deleteReportId);
      toast({ title: "Report deleted" });
    } catch (error) {
      toast({ title: "Failed to delete report", variant: "destructive" });
    }
    setDeleteReportId(null);
  };

  const monthlyReports = reports?.filter(r => r.report_type === "monthly_security") || [];
  const insuranceReports = reports?.filter(r => r.report_type === "cyber_insurance") || [];

  if (showGenerator) {
    return (
      <ReportGenerator 
        reportType={generatorType} 
        onClose={() => setShowGenerator(false)} 
      />
    );
  }

  if (previewReport) {
    const report = reports?.find(r => r.id === previewReport);
    if (report) {
      return (
        <ReportPreview 
          report={report} 
          onClose={() => setPreviewReport(null)} 
        />
      );
    }
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Security Reports</h1>
          <p className="text-muted-foreground">
            Generate and export formal compliance and threat reports
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="generate">Generate Report</TabsTrigger>
            <TabsTrigger value="history">Report History</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Monthly Security Report */}
              <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => handleNewReport("monthly_security")}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Monthly Security Report</CardTitle>
                      <CardDescription>Executive summary with threats & compliance</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Security score & trends</li>
                    <li>• Threat detection summary</li>
                    <li>• Compliance metrics</li>
                    <li>• Endpoint inventory status</li>
                    <li>• Actionable recommendations</li>
                  </ul>
                  <Button className="w-full mt-4">
                    <Plus className="mr-2 h-4 w-4" />
                    Generate Report
                  </Button>
                </CardContent>
              </Card>

              {/* Cyber Insurance Report */}
              <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => handleNewReport("cyber_insurance")}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <Shield className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Cyber Insurance Report</CardTitle>
                      <CardDescription>Security controls coverage evidence</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Security controls inventory</li>
                    <li>• Coverage percentages</li>
                    <li>• Implementation status</li>
                    <li>• Compliance evidence</li>
                    <li>• Risk mitigation summary</li>
                  </ul>
                  <Button className="w-full mt-4" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Generate Report
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {error ? (
              <QueryError error={error} title="Couldn't load reports" bare />
            ) : isLoading ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Loading reports...
                </CardContent>
              </Card>
            ) : reports?.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No reports generated yet. Create your first report above.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {monthlyReports.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Monthly Security Reports
                    </h3>
                    <div className="space-y-2">
                      {monthlyReports.map(report => (
                        <Card key={report.id}>
                          <CardContent className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{report.report_title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {format(new Date(report.report_period_start), "MMM d, yyyy")} - {format(new Date(report.report_period_end), "MMM d, yyyy")}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setPreviewReport(report.id)}>
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteReportId(report.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {insuranceReports.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      Cyber Insurance Reports
                    </h3>
                    <div className="space-y-2">
                      {insuranceReports.map(report => (
                        <Card key={report.id}>
                          <CardContent className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{report.report_title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {format(new Date(report.report_period_start), "MMM d, yyyy")} - {format(new Date(report.report_period_end), "MMM d, yyyy")}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setPreviewReport(report.id)}>
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteReportId(report.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!deleteReportId} onOpenChange={() => setDeleteReportId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this report? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default Reports;
