import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Crosshair } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuickIocSearch } from "@/components/hunting/QuickIocSearch";
import { IocLibraryManager } from "@/components/hunting/IocLibraryManager";
import { HuntJobsList } from "@/components/hunting/HuntJobsList";

export default function ThreatHunting() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || "";

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Crosshair className="h-6 w-6" />
              Threat Hunting
            </h1>
            <p className="text-muted-foreground">
              Search for indicators of compromise across your endpoints
            </p>
          </div>
        </div>

        <Tabs defaultValue="search" className="space-y-4">
          <TabsList>
            <TabsTrigger value="search">Quick Search</TabsTrigger>
            <TabsTrigger value="library">IOC Library</TabsTrigger>
            <TabsTrigger value="history">Hunt History</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-4">
            <QuickIocSearch initialValue={initialSearch} />
          </TabsContent>

          <TabsContent value="library" className="space-y-4">
            <IocLibraryManager />
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <HuntJobsList />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
