import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RouterInventory } from "@/components/routers/RouterInventory";
import { RouterDnsManager } from "@/components/routers/RouterDnsManager";
import { RouterTunnels } from "@/components/routers/RouterTunnels";
import { RouterFirewall } from "@/components/routers/RouterFirewall";
import { RouterOnboarding } from "@/components/routers/RouterOnboarding";
import { Router, Globe, ArrowLeftRight, ShieldCheck, KeyRound } from "lucide-react";

export default function Routers() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">SD-WAN Router Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage routers, DNS, tunnels, and firewall policies across your SD-WAN infrastructure
          </p>
        </div>

        <Tabs defaultValue="inventory" className="space-y-6">
          <TabsList>
            <TabsTrigger value="inventory" className="flex items-center gap-2">
              <Router className="h-4 w-4" />
              Inventory
            </TabsTrigger>
            <TabsTrigger value="onboarding" className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Onboarding
            </TabsTrigger>
            <TabsTrigger value="dns" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              DNS
            </TabsTrigger>
            <TabsTrigger value="tunnels" className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Tunnels
            </TabsTrigger>
            <TabsTrigger value="firewall" className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Firewall
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="space-y-6">
            <RouterInventory />
          </TabsContent>

          <TabsContent value="onboarding" className="space-y-6">
            <RouterOnboarding />
          </TabsContent>

          <TabsContent value="dns" className="space-y-6">
            <RouterDnsManager />
          </TabsContent>

          <TabsContent value="tunnels" className="space-y-6">
            <RouterTunnels />
          </TabsContent>

          <TabsContent value="firewall" className="space-y-6">
            <RouterFirewall />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
