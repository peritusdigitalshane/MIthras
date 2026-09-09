import { MainLayout } from "@/components/layout/MainLayout";
import { EndpointGroupsManager } from "@/components/endpoints/EndpointGroupsManager";

const Groups = () => {
  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Endpoint Groups</h1>
          <p className="text-sm text-muted-foreground">
            Organize endpoints into groups and assign policies in bulk
          </p>
        </div>

        <EndpointGroupsManager />
      </div>
    </MainLayout>
  );
};

export default Groups;
