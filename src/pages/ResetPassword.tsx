import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Lock, CheckCircle, ShieldAlert } from "lucide-react";
import { Seo } from "@/components/seo/Seo";

const passwordPolicyOk = (pw: string) =>
  pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

const ResetPassword = () => {
  const navigate = useNavigate();
  // The recovery JWT lands either in URL hash (#access_token=...) or query
  // (?code=...) depending on Supabase auth-helpers version. supabase-js auto-
  // exchanges it on import and emits a PASSWORD_RECOVERY event.
  const [authReady, setAuthReady] = useState(false);
  const [sessionOk, setSessionOk] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSessionOk(!!data.session);
      setAuthReady(true);
    };
    init();
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        if (!cancelled) { setSessionOk(true); setAuthReady(true); }
      }
    });
    return () => { cancelled = true; sub.data.subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!passwordPolicyOk(pw)) {
      setErr("Password must be 12+ characters and include lowercase, uppercase, digit, and symbol.");
      return;
    }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) { setErr(error.message); return; }
      setDone(true);
      // Sign out the recovery session so the user has to re-login with the new password.
      await supabase.auth.signOut();
      setTimeout(() => navigate("/login"), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <Seo
      title="Reset password — Mithras Threat Defence"
      description="Reset your Mithras Threat Defence account password."
      canonical="/reset-password"
      noindex
    />
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle>Set a new password</CardTitle>
          </div>
          <CardDescription>
            You arrived here from a password-reset link. Choose a new password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!authReady ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : !sessionOk ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>This link is expired or invalid</AlertTitle>
              <AlertDescription>
                Request a fresh reset email from the sign-in page, or ask your administrator.
                <div className="mt-3"><Button variant="outline" size="sm" onClick={() => navigate("/login")}>Back to sign in</Button></div>
              </AlertDescription>
            </Alert>
          ) : done ? (
            <Alert className="border-status-healthy/40">
              <CheckCircle className="h-4 w-4 text-status-healthy" />
              <AlertTitle>Password updated</AlertTitle>
              <AlertDescription>Sign in with your new password. Redirecting…</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={12} autoFocus />
                {pw.length > 0 && !passwordPolicyOk(pw) && (
                  <p className="text-xs text-muted-foreground">Must be 12+ chars and include lowercase, uppercase, digit, and symbol.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm new password</Label>
                <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={12} />
              </div>
              {err && <Alert variant="destructive"><AlertDescription className="text-xs">{err}</AlertDescription></Alert>}
              <Button type="submit" className="w-full" disabled={submitting || !passwordPolicyOk(pw) || pw !== pw2}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Update password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  );
};

export default ResetPassword;
