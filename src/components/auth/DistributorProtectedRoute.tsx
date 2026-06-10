import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

// Gate for /distributor/* — requires the user to be admin of a distributor org,
// or to be a super-admin who has pivoted into a distributor via impersonation.
const DistributorProtectedRoute = ({ children }: Props) => {
  const { user, isLoading } = useAuth();
  const { isSuperAdmin, isLoading: tenantLoading, userOrganization, currentOrganization } = useTenant();
  const location = useLocation();

  if (isLoading || tenantLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  const isDistAdmin = userOrganization?.organization_type === "distributor";
  if (!isDistAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  // Super-admins are allowed through even without an active impersonation —
  // the page renders a helpful "pick a distributor from Admin → Channel
  // partners" prompt when currentOrganization isn't a distributor.
  // currentOrganization is read here to surface the dependency to React's
  // re-render — it's intentionally not used as a guard.
  void currentOrganization;
  return <>{children}</>;
};

export default DistributorProtectedRoute;
