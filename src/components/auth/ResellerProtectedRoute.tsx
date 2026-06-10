import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

const ResellerProtectedRoute = ({ children }: Props) => {
  const { user, isLoading } = useAuth();
  const { isPartnerAdmin, isSuperAdmin, isLoading: tenantLoading } = useTenant();
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
  // Super-admins can browse the reseller portal too (for support); regular
  // org members (non-partner customers) get bounced back to the dashboard.
  if (!isPartnerAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

export default ResellerProtectedRoute;
