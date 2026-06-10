import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2 } from "lucide-react";

const passwordPolicyOk = (pw: string) =>
  pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

export function ChangePassword() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    if (!passwordPolicyOk(pw)) {
      toast({ title: "Password too weak", description: "12+ chars + lowercase + uppercase + digit + symbol.", variant: "destructive" });
      return;
    }
    if (pw !== pw2) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }

    setSubmitting(true);
    try {
      // Re-authenticate with the current password before allowing the change.
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (signErr) {
        toast({ title: "Current password is wrong", description: signErr.message, variant: "destructive" });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Password updated" });
      setCurrent(""); setPw(""); setPw2("");
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Change password</CardTitle>
        </div>
        <CardDescription>Re-authenticate with your current password to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3 max-w-md">
          <div className="space-y-1">
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="np">New password</Label>
            <Input id="np" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={12} autoComplete="new-password" />
            {pw.length > 0 && !passwordPolicyOk(pw) && (
              <p className="text-xs text-muted-foreground">12+ chars including lowercase, uppercase, digit, and symbol.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="np2">Confirm new password</Label>
            <Input id="np2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={12} autoComplete="new-password" />
          </div>
          <Button type="submit" disabled={submitting || !current || !passwordPolicyOk(pw) || pw !== pw2}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
