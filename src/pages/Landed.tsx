import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

// Lands the user on the right portal landing for their org type.
// Hit by /dashboard for anyone who isn't a partner-tier operator — keeps
// Login.tsx unchanged (still navigates to /dashboard after sign-in) while
// putting distys into /distributor, customers into /customer, super-admins
// into the regular SOC dashboard, and partners into the regular dashboard
// they already see today.
export default function Landed() {
  const { user, isLoading: authLoading } = useAuth();
  const { isSuperAdmin, isLoading: tenantLoading, userOrganization } = useTenant();

  if (authLoading || tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  // Super-admins keep the full operational dashboard.
  if (isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const t = userOrganization?.organization_type;
  if (t === "distributor") return <Navigate to="/distributor" replace />;
  if (t === "customer")    return <Navigate to="/customer" replace />;
  // E4 fix: home-user subscribers land on their own self-service /account
  // page, not the SOC console. They have no endpoints to operate beyond
  // their own PC.
  if (t === "home_user")   return <Navigate to="/account" replace />;
  // partner OR unknown → existing SOC dashboard (partners operate the platform).
  return <Navigate to="/dashboard" replace />;
}
