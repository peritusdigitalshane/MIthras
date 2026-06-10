import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/ui/stat-card";
import { SecurityScore } from "@/components/dashboard/SecurityScore";
import { ThreatsList } from "@/components/dashboard/ThreatsList";
import { EndpointsTable } from "@/components/dashboard/EndpointsTable";
import { ComplianceChart } from "@/components/dashboard/ComplianceChart";
import { AiSocSummaryCard } from "@/components/dashboard/AiSocSummaryCard";
import { M365SummaryCard } from "@/components/dashboard/M365SummaryCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, Monitor, AlertTriangle, CheckCircle, Sparkles, Activity, AlertCircle, RefreshCw } from "lucide-react";
import { useDashboardStats } from "@/hooks/useDashboardData";
import { Link } from "react-router-dom";
import { OnboardingChecklist } from "@/components/help/OnboardingChecklist";

const Dashboard = () => {
  const {
    isLoading,
    error,
    totalEndpoints,
    protectedCount,
    activeThreats,
    compliancePercentage,
    securityScore,
    recommendations,
  } = useDashboardStats();

  if (error) {
    return (
      <MainLayout>
        <div className="p-6 max-w-3xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load dashboard data</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm">{(error as Error).message ?? "An unexpected error occurred."}</p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Security Dashboard</h1>
            <p className="text-muted-foreground">
              Overview of your endpoint security posture
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/soc">
                <Activity className="mr-2 h-4 w-4" />
                SOC Console
              </Link>
            </Button>
            <Button asChild>
              <Link to="/recommendations">
                <Sparkles className="mr-2 h-4 w-4" />
                AI Recommendations
              </Link>
            </Button>
          </div>
        </div>

        {/* Onboarding checklist -- shows for orgs that haven't completed the basics. Auto-hides at 100%. */}
        <OnboardingChecklist />

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Endpoints"
            value={isLoading ? "-" : totalEndpoints.toString()}
            icon={Monitor}
          />
          <StatCard
            title="Protected"
            value={isLoading ? "-" : protectedCount.toString()}
            icon={Shield}
          />
          <StatCard
            title="Active Threats"
            value={isLoading ? "-" : activeThreats.toString()}
            icon={AlertTriangle}
          />
          <StatCard
            title="Compliant"
            value={isLoading ? "-" : `${compliancePercentage}%`}
            icon={CheckCircle}
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Security Score */}
          <div className="lg:col-span-1">
            <SecurityScore 
              score={isLoading ? 0 : securityScore} 
              endpointCount={totalEndpoints}
              recommendations={recommendations}
            />
          </div>

          {/* Compliance Chart */}
          <div className="lg:col-span-2">
            <ComplianceChart />
          </div>
        </div>

        {/* AI SOC + M365 row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AiSocSummaryCard />
          <M365SummaryCard />
        </div>

        {/* Threats and Endpoints */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ThreatsList />
          <EndpointsTable limit={5} />
        </div>
      </div>
    </MainLayout>
  );
};

export default Dashboard;
