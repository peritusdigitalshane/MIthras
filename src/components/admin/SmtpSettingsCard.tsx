import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Loader2, Save, Send, AlertCircle, ShieldCheck } from "lucide-react";

interface SmtpSettings {
  smtp_provider: "disabled" | "m365" | "sendgrid" | "custom";
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_from_email: string;
  smtp_from_name: string;
  smtp_use_starttls: boolean;
}

const M365_DEFAULTS     = { smtp_host: "smtp.office365.com",  smtp_port: 587, smtp_use_starttls: true };
// SendGrid's SMTP relay. The username is the literal string "apikey" - the
// API key itself goes in the password field. Their server only listens on
// STARTTLS-enabled ports.
const SENDGRID_DEFAULTS = { smtp_host: "smtp.sendgrid.net",    smtp_port: 587, smtp_use_starttls: true, smtp_username: "apikey" };

async function call(action: string, payload: Record<string, unknown> = {}) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const resp = await fetch(`${supabaseUrl}/functions/v1/smtp-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
  return json;
}

export function SmtpSettingsCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [s, setS] = useState<SmtpSettings>({
    smtp_provider: "disabled",
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    smtp_password: "",
    smtp_from_email: "",
    smtp_from_name: "Mithras",
    smtp_use_starttls: true,
  });
  const [hasStoredPw, setHasStoredPw] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await call("get");
        const out = (r.settings ?? {}) as Partial<SmtpSettings> & { smtp_password?: string };
        setS(prev => ({ ...prev, ...out, smtp_password: "" }));
        setHasStoredPw(out.smtp_password === "__redacted__");
      } catch (e) {
        toast({ title: "Couldn't load SMTP settings", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      } finally { setLoading(false); }
    })();
  }, [toast]);

  const handleProviderChange = (v: "disabled" | "m365" | "sendgrid" | "custom") => {
    if (v === "m365") {
      setS(prev => ({ ...prev, smtp_provider: v, ...M365_DEFAULTS }));
    } else if (v === "sendgrid") {
      setS(prev => ({ ...prev, smtp_provider: v, ...SENDGRID_DEFAULTS }));
    } else {
      setS(prev => ({ ...prev, smtp_provider: v }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await call("save", { settings: s });
      toast({ title: "SMTP settings saved", description: "Run a test send to confirm. Password-reset emails use a separate auth service that needs a restart to pick up the new SMTP settings." });
      if (s.smtp_password) setHasStoredPw(true);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!testTo.trim()) { toast({ title: "Enter a To address" }); return; }
    setTesting(true);
    try {
      const target = testTo.trim();
      await call("test", { to: target });
      toast({ title: "Test email sent", description: `Check inbox at ${target}.` });
      setTestTo("");
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setTesting(false); }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Email (SMTP)</CardTitle>
        </div>
        <CardDescription>
          Outbound email for password-reset links, customer reports, and admin notifications. Built-in support for Microsoft 365 (SMTP AUTH + app password), SendGrid (API-key SMTP relay), or any custom SMTP server with STARTTLS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="provider">Provider</Label>
          <Select value={s.smtp_provider} onValueChange={handleProviderChange}>
            <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="m365">Microsoft 365</SelectItem>
              <SelectItem value="sendgrid">SendGrid</SelectItem>
              <SelectItem value="custom">Custom SMTP relay</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {s.smtp_provider !== "disabled" && (
          <>
            {s.smtp_provider === "m365" && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle className="text-sm">Microsoft 365 setup checklist</AlertTitle>
                <AlertDescription className="text-xs space-y-1 mt-1">
                  <div>1. In Microsoft 365 admin centre, enable SMTP AUTH on the mailbox you'll send from.</div>
                  <div>2. The account needs MFA enabled and an <strong>app password</strong> generated (Microsoft → Security → Additional security verification → App passwords).</div>
                  <div>3. Paste the email address as Username, and the app password below.</div>
                  <div>4. Click "Send test" to a real inbox you control.</div>
                </AlertDescription>
              </Alert>
            )}

            {s.smtp_provider === "sendgrid" && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle className="text-sm">SendGrid setup checklist</AlertTitle>
                <AlertDescription className="text-xs space-y-1 mt-1">
                  <div>1. In SendGrid → Settings → API Keys, create a key with the <strong>Mail Send</strong> permission (Restricted Access is enough).</div>
                  <div>2. Verify the From address you intend to use either via Single Sender Verification or Domain Authentication. Unverified senders are silently rejected.</div>
                  <div>3. Leave Username as <code className="font-mono">apikey</code> (literal string — not your account email). Paste the API key into Password below.</div>
                  <div>4. Click "Send test" to a real inbox you control. SendGrid's activity feed shows accepted vs bounced in real time.</div>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="host">SMTP host</Label>
                <Input id="host" value={s.smtp_host} onChange={(e) => setS(p => ({ ...p, smtp_host: e.target.value }))} placeholder="smtp.office365.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port">Port</Label>
                <Input id="port" type="number" value={s.smtp_port} onChange={(e) => setS(p => ({ ...p, smtp_port: parseInt(e.target.value || "587") }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">
                {s.smtp_provider === "sendgrid" ? "Username (must be literal 'apikey')" : "Username (mailbox / email address)"}
              </Label>
              <Input id="username" value={s.smtp_username} onChange={(e) => setS(p => ({ ...p, smtp_username: e.target.value }))} placeholder={s.smtp_provider === "sendgrid" ? "apikey" : "noreply@yourdomain.com"} autoComplete="off" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">
                {s.smtp_provider === "sendgrid" ? "SendGrid API key" : "App password"}
              </Label>
              <Input id="password" type="password" value={s.smtp_password} onChange={(e) => setS(p => ({ ...p, smtp_password: e.target.value }))} placeholder={hasStoredPw ? "•••••••••• (saved — leave blank to keep)" : (s.smtp_provider === "sendgrid" ? "SG.xxxxxxxxxxxxxxxxx" : "")} autoComplete="new-password" />
              {hasStoredPw && !s.smtp_password && (
                <p className="text-[11px] text-muted-foreground">A password is already saved. Type a new one to replace it, or leave blank to keep.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From address</Label>
                <Input id="fromEmail" value={s.smtp_from_email} onChange={(e) => setS(p => ({ ...p, smtp_from_email: e.target.value }))} placeholder="noreply@yourdomain.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromName">From name</Label>
                <Input id="fromName" value={s.smtp_from_name} onChange={(e) => setS(p => ({ ...p, smtp_from_name: e.target.value }))} placeholder="Mithras Threat Defence" />
              </div>
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <div className="space-y-0.5">
                <Label htmlFor="tls" className="font-medium">Use STARTTLS</Label>
                <p className="text-xs text-muted-foreground">Required for Microsoft 365 and the only safe option for SMTP AUTH.</p>
              </div>
              <Switch id="tls" checked={s.smtp_use_starttls} onCheckedChange={(v) => setS(p => ({ ...p, smtp_use_starttls: v }))} />
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save settings
          </Button>
          {s.smtp_provider !== "disabled" && (
            <div className="flex flex-1 gap-2 min-w-[300px]">
              <Input
                type="email"
                autoComplete="email"
                placeholder={`Send test to (default: ${user?.email ?? "an email address"})`}
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                onFocus={() => { if (!testTo && user?.email) setTestTo(user.email); }}
              />
              <Button variant="outline" onClick={handleTest} disabled={testing || !testTo.trim()}>
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send test
              </Button>
            </div>
          )}
        </div>

        {s.smtp_provider !== "disabled" && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-sm">One extra step to start sending password-reset emails</AlertTitle>
            <AlertDescription className="text-xs">
              The auth service that mints password-recovery emails reads its SMTP settings at startup. After saving here, an operator with host access needs to mirror the same values into the auth service's environment and restart it. The &quot;Send test&quot; button above proves the credentials themselves work end-to-end.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
