import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

// Gate for /account. Home users are individual paying customers — the only
// thing they need post-login is a way to manage their Stripe subscription
// (update card, cancel). Super-admins also get through so support can
// view the account page on a user's behalf.
const HomeUserProtectedRoute = ({ children }: Props) => {
  const { user, isLoading } = useAuth();
  const { isSuperAdmin, currentOrganization, isLoading: tenantLoading } = useTenant();
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
  const isHomeUserView = currentOrganization?.organization_type === "home_user";
  if (!isHomeUserView && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

export default HomeUserProtectedRoute;
