import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServiceAccessMatrix } from "@/components/network/ServiceAccessMatrix";
import { FirewallAuditLogs } from "@/components/network/FirewallAuditLogs";
import { FirewallAuditWorkflow } from "@/components/network/FirewallAuditWorkflow";
import { MicrosegmentationDashboard } from "@/components/network/MicrosegmentationDashboard";
import { Network as NetworkIcon, ScrollText, Radio, KeyRound, Shield } from "lucide-react";

export default function Network() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Network Security</h1>
          <p className="text-muted-foreground mt-1">
            Manage firewall policies and monitor network connections
          </p>
        </div>

        <FirewallAuditWorkflow />

        <Tabs defaultValue="microseg" className="space-y-6">
          <TabsList>
            <TabsTrigger value="microseg" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Microsegmentation
            </TabsTrigger>
            <TabsTrigger value="firewall" className="flex items-center gap-2">
              <NetworkIcon className="h-4 w-4" />
              Firewall Matrix
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              Audit Logs
            </TabsTrigger>
            <TabsTrigger value="connections" className="flex items-center gap-2" disabled>
              <Radio className="h-4 w-4" />
              Connections
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Soon</span>
            </TabsTrigger>
            <TabsTrigger value="access" className="flex items-center gap-2" disabled>
              <KeyRound className="h-4 w-4" />
              Access Requests
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Soon</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="microseg" className="space-y-6">
            <MicrosegmentationDashboard />
          </TabsContent>

          <TabsContent value="firewall" className="space-y-6">
            <ServiceAccessMatrix />
          </TabsContent>

          <TabsContent value="audit" className="space-y-6">
            <FirewallAuditLogs />
          </TabsContent>

          <TabsContent value="connections">
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Live connection monitoring coming soon
            </div>
          </TabsContent>

          <TabsContent value="access">
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Just-in-time access requests coming soon
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
