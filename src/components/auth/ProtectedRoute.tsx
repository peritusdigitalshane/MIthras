import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, isLoading } = useAuth();
  const { isSuperAdmin, isPartnerAdmin, isLoading: tenantLoading } = useTenant();
  const location = useLocation();

  // B5: super-admins and partner-admins MUST have AAL2 (MFA verified this session).
  // Standard org members are not forced — that's an org-level toggle on the roadmap.
  const [aalLevel, setAalLevel] = useState<"aal1" | "aal2" | "unknown">("unknown");
  const [aalChecked, setAalChecked] = useState(false);

  useEffect(() => {
    if (!user) { setAalChecked(true); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      setAalLevel((data?.currentLevel as "aal1" | "aal2") ?? "unknown");
      setAalChecked(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (isLoading || tenantLoading || !aalChecked) {
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

  // Always allow /settings through the gate so super-admins / partner-admins
  // can reach the MFA enrollment UI (MfaSettings) even on first login.
  // Without this, a freshly-promoted super-admin who hasn't enrolled MFA is
  // locked out of every protected route with no escape — there's no
  // unauthenticated MFA enrollment flow.
  const isSettingsPath = location.pathname === "/settings";
  const needsAal2 = (isSuperAdmin || isPartnerAdmin) && !isSettingsPath;
  if (needsAal2 && aalLevel !== "aal2") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full space-y-4">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Multi-factor authentication required</AlertTitle>
            <AlertDescription className="space-y-2 mt-2">
              <p>Your account has cross-tenant access. You must enrol an authenticator app and complete an MFA challenge each session before continuing.</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" onClick={() => { supabase.auth.signOut(); window.location.href = "/login"; }}>
                  Sign out &amp; re-authenticate
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.location.href = "/settings"}>
                  Enrol MFA
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
