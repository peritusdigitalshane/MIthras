import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardeningDashboard } from "@/components/hardening/HardeningDashboard";
import { HardeningEndpoints } from "@/components/hardening/HardeningEndpoints";
import { HardeningProfilesManager } from "@/components/hardening/HardeningProfilesManager";
import { HardeningRecommendationsView } from "@/components/hardening/HardeningRecommendationsView";
import { ShieldAlert } from "lucide-react";

export default function LegacyHardening() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Legacy OS Hardening</h1>
              <p className="text-muted-foreground">
                Harden Windows 10 &amp; Server 2012 R2 endpoints to eliminate the need for Extended Security Updates
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="endpoints">Legacy Endpoints</TabsTrigger>
            <TabsTrigger value="profiles">Hardening Profiles</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <HardeningDashboard />
          </TabsContent>
          <TabsContent value="endpoints">
            <HardeningEndpoints />
          </TabsContent>
          <TabsContent value="profiles">
            <HardeningProfilesManager />
          </TabsContent>
          <TabsContent value="recommendations">
            <HardeningRecommendationsView />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
