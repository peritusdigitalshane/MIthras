import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Copy, Mail, KeyRound, CheckCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const passwordPolicyOk = (pw: string) =>
  pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

// Cryptographically secure random integer in [0, max) using rejection sampling
// to avoid modulo bias. Math.random() would expose generated passwords to
// prediction if Chrome's PRNG state were ever inferred from other timing.
function cryptoRandInt(max: number): number {
  if (max <= 0 || max > 0xffff_ffff) throw new Error("cryptoRandInt: bad range");
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function pick(s: string): string { return s[cryptoRandInt(s.length)]; }

function generateTempPassword(): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digit = "0123456789";
  const sym   = "!@#$%^&*()-_=+";
  const all   = lower + upper + digit + sym;
  // Guarantee at least one of each class.
  const chars = [pick(lower), pick(upper), pick(digit), pick(sym)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher–Yates shuffle using crypto-grade entropy.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = cryptoRandInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId: string;
  targetEmail: string;
}

export function ResetUserPasswordDialog({ open, onOpenChange, targetUserId, targetEmail }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"email_link" | "temp_password">("email_link");
  const [submitting, setSubmitting] = useState(false);
  const [linkResult, setLinkResult] = useState<{ link: string; email_sent: boolean } | null>(null);
  const [tempPw, setTempPw] = useState(generateTempPassword());
  const [tempDone, setTempDone] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in.");
    const resp = await fetch(`${supabaseUrl}/functions/v1/admin-reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) {
      // Prefer the specific GoTrue reason when present (e.g. the actual
      // password-policy violation) over the opaque function-level code.
      const detail = (json.details ?? "").toString().trim();
      const base = json.error ?? `HTTP ${resp.status}`;
      throw new Error(detail ? `${base}: ${detail}` : base);
    }
    return json;
  };

  const handleEmailLink = async () => {
    setSubmitting(true);
    try {
      const r = await call({ mode: "email_link", target_user_id: targetUserId });
      setLinkResult({ link: r.action_link, email_sent: r.email_sent });
    } catch (e) {
      toast({ title: "Reset failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const handleTempPassword = async () => {
    if (!passwordPolicyOk(tempPw)) {
      toast({ title: "Password too weak", description: "12+ chars + lowercase + uppercase + digit + symbol.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await call({ mode: "temp_password", target_user_id: targetUserId, password: tempPw });
      setTempDone(true);
    } catch (e) {
      toast({ title: "Reset failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const handleClose = (o: boolean) => {
    if (!o) {
      setLinkResult(null); setTempDone(false);
      setTempPw(generateTempPassword());
    }
    onOpenChange(o);
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast({ title: "Copied" }));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Reset password</DialogTitle>
          <DialogDescription>For <code className="text-xs">{targetEmail}</code></DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="email_link"><Mail className="h-3.5 w-3.5 mr-1.5" />Email reset link</TabsTrigger>
            <TabsTrigger value="temp_password"><KeyRound className="h-3.5 w-3.5 mr-1.5" />Set temporary password</TabsTrigger>
          </TabsList>

          <TabsContent value="email_link" className="space-y-3 pt-3">
            {!linkResult ? (
              <>
                <Alert>
                  <AlertTitle className="text-sm">Mints a recovery link valid for 1 hour.</AlertTitle>
                  <AlertDescription className="text-xs">
                    If SMTP is configured the user is emailed automatically. Either way you'll see the link here so you can share it manually.
                  </AlertDescription>
                </Alert>
                <Button onClick={handleEmailLink} disabled={submitting} className="w-full">
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Generate reset link
                </Button>
              </>
            ) : (
              <>
                <Alert className="border-status-healthy/40">
                  <CheckCircle className="h-4 w-4 text-status-healthy" />
                  <AlertTitle>Link generated</AlertTitle>
                  <AlertDescription className="text-xs">
                    {linkResult.email_sent ? "Email was dispatched to the user." : "SMTP not configured — share the link below directly."}
                  </AlertDescription>
                </Alert>
                <div className="space-y-1.5">
                  <Label className="text-xs">Recovery link</Label>
                  <div className="flex gap-1">
                    <Input value={linkResult.link} readOnly className="text-xs font-mono" />
                    <Button size="icon" variant="outline" onClick={() => copy(linkResult.link)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="temp_password" className="space-y-3 pt-3">
            {!tempDone ? (
              <>
                <Alert>
                  <AlertTitle className="text-sm">Sets the password directly.</AlertTitle>
                  <AlertDescription className="text-xs">
                    Use when SMTP isn't available, or when you want to hand the password to the user out of band. Tell them to change it on their next sign-in (Settings &rarr; Change password).
                  </AlertDescription>
                </Alert>
                <div className="space-y-1.5">
                  <Label htmlFor="tp" className="text-xs">Temporary password</Label>
                  <div className="flex gap-1">
                    <Input id="tp" value={tempPw} onChange={(e) => setTempPw(e.target.value)} className="font-mono" />
                    <Button size="icon" variant="outline" onClick={() => setTempPw(generateTempPassword())} title="Regenerate"><RefreshCw className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="outline" onClick={() => copy(tempPw)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                  {!passwordPolicyOk(tempPw) && (
                    <p className="text-[11px] text-muted-foreground">12+ chars + lowercase + uppercase + digit + symbol.</p>
                  )}
                </div>
                <Button onClick={handleTempPassword} disabled={submitting || !passwordPolicyOk(tempPw)} className="w-full">
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Set as user's password
                </Button>
              </>
            ) : (
              <Alert className="border-status-healthy/40">
                <CheckCircle className="h-4 w-4 text-status-healthy" />
                <AlertTitle>Password updated</AlertTitle>
                <AlertDescription className="text-xs space-y-2">
                  <p>Hand the password to the user via a secure channel. Remind them to change it once they sign in.</p>
                  <div className="flex gap-1">
                    <Input value={tempPw} readOnly className="font-mono text-xs" />
                    <Button size="icon" variant="outline" onClick={() => copy(tempPw)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
