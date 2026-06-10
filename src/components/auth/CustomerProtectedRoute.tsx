import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

// Gate for /customer/* — requires the active org to be a customer org
// (the user is a member of a customer-typed organisation). Super-admins
// and partner-admins pivoted into a customer also get access; this lets
// resellers preview what their customers see.
const CustomerProtectedRoute = ({ children }: Props) => {
  const { user, isLoading } = useAuth();
  const { isSuperAdmin, isPartnerAdmin, currentOrganization, isLoading: tenantLoading } = useTenant();
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
  const isCustomerView = currentOrganization?.organization_type === "customer";
  if (!isCustomerView && !isSuperAdmin && !isPartnerAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

export default CustomerProtectedRoute;
