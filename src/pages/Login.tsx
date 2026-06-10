import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ArrowLeft, CheckCircle, XCircle, Building2, Smartphone, Info, Sparkles, Shield, Briefcase, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useValidateEnrollmentCode } from "@/hooks/useEnrollmentCodes";

// Portal role chosen on the marketing site dropdown. Determines post-auth
// landing — anyone without ?role= still goes to /dashboard, preserving the
// existing user experience.
type PortalRole = "customer" | "partner" | "distributor";

const ROLE_META: Record<PortalRole, { label: string; landing: string; icon: typeof Shield; accent: string; tagline: string }> = {
  customer:    { label: "Customer portal",    landing: "/customer",    icon: Shield,    accent: "text-emerald-500", tagline: "See your own security posture, threats, and reports." },
  partner:     { label: "Partner portal",     landing: "/dashboard",   icon: Briefcase, accent: "text-indigo-500",  tagline: "MSP / reseller console for managing your customers." },
  distributor: { label: "Distributor portal", landing: "/distributor", icon: Warehouse, accent: "text-primary",     tagline: "Sales kit, channel management, and billing." },
};

const Login = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  // Treat the /signup URL as a request to open the signup form regardless of
  // query params. Without this, a direct link to /signup would land on the
  // sign-in form and confuse new visitors.
  const isSignupRoute = location.pathname === "/signup";
  const [isSignUp, setIsSignUp] = useState(
    isSignupRoute || searchParams.get("mode") === "signup",
  );

  // Portal role chosen on the marketing site dropdown. Stays null when the
  // user reaches /login directly — that path retains the existing landing.
  const roleParam = searchParams.get("role") as PortalRole | null;
  const portalRole: PortalRole | null = (roleParam && roleParam in ROLE_META) ? roleParam : null;
  const postAuthLanding = portalRole ? ROLE_META[portalRole].landing : "/dashboard";

  // After sign-in, send the user to the portal that matches their org type
  // even when they reached /login without a ?role=... query param.
  // Super-admin path stays /dashboard so the SOC console still lands first.
  const resolveLanding = async (userId: string): Promise<string> => {
    try {
      const { data: superRow } = await supabase
        .from("super_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (superRow) return postAuthLanding;

      const { data } = await supabase
        .from("organization_memberships")
        .select("organizations!inner(organization_type)")
        .eq("user_id", userId)
        .limit(5);
      const types = (data ?? []).map((r: any) => r.organizations?.organization_type);
      if (types.includes("home_user"))   return "/account";
      if (types.includes("distributor")) return "/distributor";
      if (types.includes("partner"))     return "/partner";
      if (types.includes("customer"))    return "/customer";
    } catch {
      // Non-fatal: fall back to the default landing if the lookup fails.
    }
    return postAuthLanding;
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState(searchParams.get("code") || "");
  const [isLoading, setIsLoading] = useState(false);
  const [codeValidation, setCodeValidation] = useState<{
    isValid: boolean;
    orgName: string | null;
    error: string | null;
  } | null>(null);
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  
  // Free trial option
  // Free-trial path removed — Mithras is sold through channel partners only.
  // State variable kept (always false) so the existing dependency arrays
  // don't need rewriting; tree-shaken at build time.
  const useFreeTrial = false;
  
  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);
  
  const navigate = useNavigate();
  const { toast } = useToast();
  const validateCode = useValidateEnrollmentCode();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Check MFA status
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.currentLevel === "aal1" && aalData?.nextLevel === "aal2") {
          // User has MFA enabled but hasn't completed it
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const totpFactor = factors?.totp?.find(f => f.status === "verified");
          if (totpFactor) {
            setMfaRequired(true);
            setMfaFactorId(totpFactor.id);
            return;
          }
        }
        navigate(await resolveLanding(session.user.id));
      }
    };
    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session && event === "SIGNED_IN") {
        // Check if MFA is required
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.currentLevel === "aal1" && aalData?.nextLevel === "aal2") {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const totpFactor = factors?.totp?.find(f => f.status === "verified");
          if (totpFactor) {
            setMfaRequired(true);
            setMfaFactorId(totpFactor.id);
            return;
          }
        }
        navigate(await resolveLanding(session.user.id));
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Validate code when it changes (debounced) - skip if using free trial
  useEffect(() => {
    if (!isSignUp || !enrollmentCode.trim()) {
      setCodeValidation(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsValidatingCode(true);
      try {
        const result = await validateCode.mutateAsync(enrollmentCode.trim().toUpperCase());
        setCodeValidation({
          isValid: result.is_valid,
          orgName: result.organization_name,
          error: result.error_message,
        });
      } catch (error) {
        setCodeValidation({
          isValid: false,
          orgName: null,
          error: "Failed to validate code",
        });
      } finally {
        setIsValidatingCode(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [enrollmentCode, isSignUp, useFreeTrial]);

  const handleMfaVerify = async () => {
    if (!mfaFactorId || mfaCode.length !== 6) return;
    
    setIsVerifyingMfa(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      
      if (challengeError) throw challengeError;
      
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });
      
      if (verifyError) throw verifyError;

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      navigate(uid ? await resolveLanding(uid) : postAuthLanding);
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
      setMfaCode("");
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isSignUp) {
        // Mithras is channel-only — every signup requires a valid enrolment
        // code issued by a distributor / reseller / super-admin. Self-serve
        // free trials are no longer offered. Prospects without a code are
        // routed to the /contact-sales lead form, which puts them in front
        // of a reseller in their region.
        if (!codeValidation?.isValid) {
          toast({
            title: "Enrolment code required",
            description: "Enter a valid enrolment code from your reseller, or visit /contact-sales to find one.",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: displayName,
              // The handle_new_user trigger validates the enrolment code and
              // joins this user to the named org. Invalid codes hard-fail
              // server-side — no silent free-trial fallback.
              enrollment_code: enrollmentCode.trim().toUpperCase(),
            },
          },
        });

        if (error) throw error;

        toast({
          title: "Check your email",
          description: "We've sent you a confirmation link to complete your signup.",
        });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        
        // Check if MFA is required after successful password auth
        if (data.session) {
          const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aalData?.currentLevel === "aal1" && aalData?.nextLevel === "aal2") {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totpFactor = factors?.totp?.find(f => f.status === "verified");
            if (totpFactor) {
              setMfaRequired(true);
              setMfaFactorId(totpFactor.id);
              setIsLoading(false);
              return;
            }
          }
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Server-side GoTrue enforces min length 12 + required-character classes (B12).
  // Mirror the rule on the client so users see the gate immediately instead of
  // bouncing off a 400 from /auth/v1/signup.
  const passwordPolicyOk = (pw: string) =>
    pw.length >= 12 &&
    /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  const canSignUp = isSignUp && displayName.trim() && email.trim() && passwordPolicyOk(password) &&
    (useFreeTrial || codeValidation?.isValid);

  // MFA Challenge Screen
  if (mfaRequired) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="p-6">
          <button 
            onClick={() => {
              supabase.auth.signOut();
              setMfaRequired(false);
              setMfaFactorId(null);
              setMfaCode("");
            }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel and sign out
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-20">
          <Card className="w-full max-w-md border-border/40">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4">
                <Smartphone className="h-6 w-6 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl">Two-Factor Authentication</CardTitle>
              <CardDescription>
                Enter the 6-digit code from your authenticator app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Open your authenticator app (Google Authenticator, Authy, etc.) and enter the current code.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Authentication Code</Label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-2xl tracking-widest font-mono"
                  autoFocus
                />
              </div>

              <Button 
                onClick={handleMfaVerify}
                className="w-full"
                disabled={mfaCode.length !== 6 || isVerifyingMfa}
              >
                {isVerifyingMfa && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Back Link */}
      <div className="p-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </div>

      {/* Login Form */}
      <div className="flex-1 flex items-center justify-center px-6 pb-20">
        <Card className="w-full max-w-md border-border/40">
          <CardHeader className="text-center pb-8">
            <img
              src="/mithras-shield.svg"
              alt="Mithras"
              className="mx-auto h-14 w-14 mb-4"
              width={56}
              height={56}
            />
            {portalRole && (() => {
              const meta = ROLE_META[portalRole];
              const Icon = meta.icon;
              return (
                <div className="inline-flex items-center gap-1.5 mx-auto px-3 py-1 rounded-full border bg-muted/50 mb-3">
                  <Icon className={`h-3.5 w-3.5 ${meta.accent}`} />
                  <span className="text-xs font-medium uppercase tracking-wider">{meta.label}</span>
                </div>
              );
            })()}
            <CardTitle className="text-2xl tracking-wide">
              {isSignUp ? "Create your account" : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {portalRole
                ? ROLE_META[portalRole].tagline
                : (isSignUp
                    ? "Start your free trial or enter an enrollment code"
                    : "Sign in to your Mithras Threat Defence account")}
            </CardDescription>
            {portalRole && !isSignUp && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Wrong portal? <Link to="/" className="underline">Pick a different one →</Link>
              </p>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <>
                  {/* No more free trial — channel-only paid model. The user
                      must have received an enrolment code from a reseller,
                      distributor, or Peritus. Prospects without a code get
                      bounced to /contact-sales below. */}
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Mithras is sold through authorised channel partners. Enter the enrolment code your reseller sent
                      you, or <Link to="/contact-sales" className="underline font-medium">talk to sales</Link> to find one.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label htmlFor="enrollmentCode">Enrolment Code</Label>
                      <div className="relative">
                        <Input
                          id="enrollmentCode"
                          type="text"
                          placeholder="XXXXXXXX"
                          value={enrollmentCode}
                          onChange={(e) => setEnrollmentCode(e.target.value.toUpperCase())}
                          className="uppercase font-mono pr-10"
                          maxLength={8}
                          required
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {isValidatingCode && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                          {!isValidatingCode && codeValidation?.isValid && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                          {!isValidatingCode && codeValidation && !codeValidation.isValid && (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                      </div>
                      {codeValidation?.isValid && codeValidation.orgName && (
                        <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
                          <Building2 className="h-4 w-4" />
                          You will join: {codeValidation.orgName}
                        </div>
                      )}
                      {codeValidation && !codeValidation.isValid && (
                        <p className="text-sm text-destructive mt-1">
                          {codeValidation.error}
                        </p>
                      )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="displayName">Your Name</Label>
                    <Input
                      id="displayName"
                      type="text"
                      placeholder="John Doe"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isSignUp ? 12 : 6}
                />
                {isSignUp && password.length > 0 && !passwordPolicyOk(password) && (
                  <p className="text-xs text-muted-foreground">
                    Must be 12+ chars and include lowercase, uppercase, digit, and symbol.
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || (isSignUp && !canSignUp)}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSignUp ? "Create Account" : "Sign In"}
              </Button>
              {!isSignUp && (
                <button
                  type="button"
                  disabled={isLoading}
                  className="block mx-auto text-xs text-muted-foreground hover:text-foreground hover:underline mt-3 disabled:opacity-50 disabled:pointer-events-none"
                  onClick={async () => {
                    if (!email.trim()) {
                      toast({ title: "Enter your email", description: "We'll send a reset link to that address.", variant: "destructive" });
                      return;
                    }
                    setIsLoading(true);
                    try {
                      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) throw error;
                      toast({
                        title: "Reset link sent",
                        description: "Check your email. If you don't get it within a few minutes, ask your administrator to mint one for you.",
                      });
                    } catch (e) {
                      toast({
                        title: "Couldn't send reset email",
                        description: e instanceof Error ? e.message : "Email may not be configured yet — ask your admin to reset it from the dashboard.",
                        variant: "destructive",
                      });
                    } finally {
                      setIsLoading(false);
                    }
                  }}
                >
                  Forgot password?
                </button>
              )}
            </form>
            <div className="mt-6 text-center text-sm">
              {isSignUp ? (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setIsSignUp(false)}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Have an enrollment code?{" "}
                  <button
                    type="button"
                    onClick={() => setIsSignUp(true)}
                    className="text-primary hover:underline font-medium"
                  >
                    Create account
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
