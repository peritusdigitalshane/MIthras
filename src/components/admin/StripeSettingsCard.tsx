import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Loader2, Save, AlertCircle, ShieldCheck, Check, X, ExternalLink } from "lucide-react";

interface StripeSettings {
  stripe_enabled: boolean;
  stripe_secret_key: string;
  stripe_webhook_secret: string;
  stripe_homeuser_price_id: string;
  stripe_homeuser_success_url: string;
  stripe_homeuser_cancel_url: string;
  stripe_homeuser_portal_return_url: string;
}

const REDACTED = "__redacted__";

async function call(action: string, payload: Record<string, unknown> = {}) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const resp = await fetch(`${supabaseUrl}/functions/v1/stripe-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
  return json;
}

export function StripeSettingsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<null | {
    enabled: boolean;
    has_secret_key: boolean;
    has_webhook_secret: boolean;
    has_homeuser_price_id: boolean;
    ping: { ok: boolean; mode?: "test" | "live"; details?: string };
  }>(null);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [hasStoredWebhook, setHasStoredWebhook] = useState(false);
  const [s, setS] = useState<StripeSettings>({
    stripe_enabled: false,
    stripe_secret_key: "",
    stripe_webhook_secret: "",
    stripe_homeuser_price_id: "",
    stripe_homeuser_success_url: "https://www.mithras.com.au/personal/success",
    stripe_homeuser_cancel_url: "https://www.mithras.com.au/personal",
    stripe_homeuser_portal_return_url: "https://www.mithras.com.au/account",
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await call("get");
        const out = (r.settings ?? {}) as Partial<StripeSettings>;
        setHasStoredSecret(out.stripe_secret_key === REDACTED);
        setHasStoredWebhook(out.stripe_webhook_secret === REDACTED);
        setS(prev => ({
          ...prev,
          ...out,
          stripe_secret_key: "",
          stripe_webhook_secret: "",
        }));
      } catch (e) {
        toast({ title: "Couldn't load Stripe settings", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      } finally { setLoading(false); }
    })();
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await call("save", { settings: s });
      toast({ title: "Stripe settings saved" });
      if (s.stripe_secret_key) setHasStoredSecret(true);
      if (s.stripe_webhook_secret) setHasStoredWebhook(true);
      setS(prev => ({ ...prev, stripe_secret_key: "", stripe_webhook_secret: "" }));
      // Re-check status so the badges update.
      handleCheck(true);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleCheck = async (silent = false) => {
    setChecking(true);
    try {
      const r = await call("status");
      setStatus(r as any);
      if (!silent) {
        if (r.ping?.ok) {
          toast({
            title: `Stripe API reachable (${r.ping.mode} mode)`,
            description: r.has_secret_key && r.has_webhook_secret && r.has_homeuser_price_id
              ? "All required keys are set."
              : "Some keys are still missing — see badges below.",
          });
        } else {
          toast({
            title: "Stripe API check failed",
            description: r.ping?.details ?? "Unknown error",
            variant: "destructive",
          });
        }
      }
    } catch (e) {
      if (!silent) toast({ title: "Check failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setChecking(false); }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent>
      </Card>
    );
  }

  const PresenceBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${ok ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/5" : "border-amber-500/40 text-amber-600 bg-amber-500/5"}`}>
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      <span>{label}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Stripe (home-user channel)</CardTitle>
        </div>
        <CardDescription>
          Powers the $6/month <code className="text-xs">/personal</code> signup and self-serve cancel via <code className="text-xs">/account</code>.
          Only used for home users — distributors, partners, and customer orgs are billed by invoice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle className="text-sm">Setup checklist</AlertTitle>
          <AlertDescription className="text-xs space-y-1 mt-1">
            <div>1. In Stripe, create a recurring <strong>$6 AUD / month</strong> price and copy its <code>price_…</code> ID.</div>
            <div>2. Grab your <code>sk_live_…</code> (or <code>sk_test_…</code>) secret key.</div>
            <div>3. In Stripe → <strong>Developers → Webhooks</strong>, add endpoint <code className="break-all">{(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/stripe-webhook</code> with events <code>checkout.session.completed</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code> — copy the signing secret (<code>whsec_…</code>).</div>
            <div>4. In Stripe → <strong>Settings → Billing → Customer portal</strong>, enable "Allow customers to cancel subscriptions" and "Allow customers to update payment methods".</div>
            <div>5. Paste everything below and save. Hit "Check status" to confirm.</div>
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between border-t pt-4">
          <div className="space-y-0.5">
            <Label htmlFor="enabled" className="font-medium">Enable Stripe billing</Label>
            <p className="text-xs text-muted-foreground">When off, the <code>/personal</code> page shows "subscriptions opening soon".</p>
          </div>
          <Switch
            id="enabled"
            checked={s.stripe_enabled}
            onCheckedChange={(v) => setS(p => ({ ...p, stripe_enabled: v }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="secret">Secret key</Label>
          <Input
            id="secret"
            type="password"
            value={s.stripe_secret_key}
            onChange={(e) => setS(p => ({ ...p, stripe_secret_key: e.target.value }))}
            placeholder={hasStoredSecret ? "•••••••••• (saved — leave blank to keep)" : "sk_live_… or sk_test_…"}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webhook">Webhook signing secret</Label>
          <Input
            id="webhook"
            type="password"
            value={s.stripe_webhook_secret}
            onChange={(e) => setS(p => ({ ...p, stripe_webhook_secret: e.target.value }))}
            placeholder={hasStoredWebhook ? "•••••••••• (saved — leave blank to keep)" : "whsec_…"}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="price">Home-user price ID</Label>
          <Input
            id="price"
            value={s.stripe_homeuser_price_id}
            onChange={(e) => setS(p => ({ ...p, stripe_homeuser_price_id: e.target.value }))}
            placeholder="price_1Nxxxxxxxxxxxxxxxxxxxxxx"
            className="font-mono text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="success_url">Success URL (after checkout)</Label>
            <Input id="success_url" value={s.stripe_homeuser_success_url} onChange={(e) => setS(p => ({ ...p, stripe_homeuser_success_url: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cancel_url">Cancel URL (if checkout is abandoned)</Label>
            <Input id="cancel_url" value={s.stripe_homeuser_cancel_url} onChange={(e) => setS(p => ({ ...p, stripe_homeuser_cancel_url: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal_url">Portal return URL (after self-serve cancel/update)</Label>
            <Input id="portal_url" value={s.stripe_homeuser_portal_return_url} onChange={(e) => setS(p => ({ ...p, stripe_homeuser_portal_return_url: e.target.value }))} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save settings
          </Button>
          <Button variant="outline" onClick={() => handleCheck(false)} disabled={checking}>
            {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            Check status
          </Button>
        </div>

        {status && (
          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              <PresenceBadge ok={status.has_secret_key} label="Secret key" />
              <PresenceBadge ok={status.has_webhook_secret} label="Webhook secret" />
              <PresenceBadge ok={status.has_homeuser_price_id} label="Home-user price" />
              {status.ping?.ok && (
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
                  <Check className="h-3 w-3" /> Stripe reachable ({status.ping.mode})
                </div>
              )}
              {status.ping && !status.ping.ok && (
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-red-500/40 text-red-600 bg-red-500/5">
                  <AlertCircle className="h-3 w-3" /> {status.ping.details ?? "ping failed"}
                </div>
              )}
            </div>
          </div>
        )}

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm">How values are resolved</AlertTitle>
          <AlertDescription className="text-xs">
            Values saved here are read by the Stripe edge functions at request time. If the same key is set
            as an environment variable in <code>/opt/peritus-supabase/.env</code>, the env var wins. This lets ops
            override per-host without touching the database.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
