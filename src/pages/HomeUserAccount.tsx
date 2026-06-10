import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Seo } from "@/components/seo/Seo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CreditCard, Mail, LogOut, ShieldCheck, AlertCircle, ExternalLink, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface HomeOrgRow {
  id: string;
  name: string;
  home_user_email: string | null;
  stripe_status: string | null;
  stripe_current_period_end: string | null;
  is_active: boolean;
}

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  active:             { label: "Active",             tone: "ok"   },
  trialing:           { label: "Trial",              tone: "ok"   },
  past_due:           { label: "Past due",           tone: "warn" },
  unpaid:             { label: "Unpaid",             tone: "bad"  },
  incomplete:         { label: "Incomplete",         tone: "warn" },
  incomplete_expired: { label: "Incomplete",         tone: "bad"  },
  canceled:           { label: "Cancelled",          tone: "bad"  },
  paused:             { label: "Paused",             tone: "warn" },
};

export default function HomeUserAccount() {
  const { user } = useAuth();
  const { currentOrganization } = useTenant();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [row, setRow] = useState<HomeOrgRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    if (!currentOrganization?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, home_user_email, stripe_status, stripe_current_period_end, is_active")
        .eq("id", currentOrganization.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast({ title: "Couldn't load your subscription", description: error.message, variant: "destructive" });
      } else {
        setRow(data as HomeOrgRow | null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentOrganization?.id, toast]);

  const openPortal = async () => {
    setOpeningPortal(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error("Not signed in");
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const resp = await fetch(`${supabaseUrl}/functions/v1/stripe-customer-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
      });
      const j = await resp.json();
      if (!resp.ok) {
        if (j.error === "stripe_not_configured") {
          toast({
            title: "Subscription management not available yet",
            description: "Stripe isn't configured on this server. Email support@mithras.com.au and we'll cancel for you.",
            variant: "destructive",
          });
          return;
        }
        if (j.error === "no_home_user_subscription") {
          toast({
            title: "No subscription found",
            description: "We couldn't find a Stripe subscription on your account. Email support@mithras.com.au.",
            variant: "destructive",
          });
          return;
        }
        throw new Error(j.details ?? j.error ?? `HTTP ${resp.status}`);
      }
      window.location.href = j.url;
    } catch (e: any) {
      toast({ title: "Couldn't open subscription portal", description: e.message, variant: "destructive" });
    } finally {
      setOpeningPortal(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = row?.stripe_status ?? "unknown";
  const statusMeta = STATUS_LABEL[status] ?? { label: status, tone: "warn" as const };
  const periodEnd = row?.stripe_current_period_end ? new Date(row.stripe_current_period_end) : null;

  return (
    <>
      <Seo title="My account — Mithras" description="Manage your Mithras home subscription." />
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
        <header className="border-b">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span className="font-semibold">Mithras</span>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
          <div>
            <h1 className="text-3xl font-bold">My account</h1>
            <p className="text-muted-foreground mt-1">Manage your Mithras Personal subscription.</p>
          </div>

          {status === "canceled" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Subscription cancelled</AlertTitle>
              <AlertDescription>
                Your Mithras subscription is no longer active. Your endpoint will stop reporting on the next heartbeat.
                Re-subscribe any time from <a className="underline" href="/personal">mithras.com.au/personal</a>.
              </AlertDescription>
            </Alert>
          )}
          {status === "past_due" && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Payment past due</AlertTitle>
              <AlertDescription>
                Your last payment didn't go through. Update your card via "Manage subscription" below to keep protection running.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Subscription
              </CardTitle>
              <CardDescription>$6 / month per Windows PC. Cancel any time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge
                  variant={statusMeta.tone === "ok" ? "default" : statusMeta.tone === "warn" ? "secondary" : "destructive"}
                >
                  {statusMeta.label}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-sm text-muted-foreground">Account email</span>
                <span className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4" /> {row?.home_user_email ?? user?.email ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {status === "canceled" ? "Access ends" : "Next billing date"}
                </span>
                <span className="text-sm font-medium">
                  {periodEnd ? periodEnd.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </span>
              </div>

              <div className="pt-2">
                <Button onClick={openPortal} disabled={openingPortal} className="w-full">
                  {openingPortal ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening Stripe…</>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" /> Manage subscription
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Update your card, change billing email, or cancel — all handled securely by Stripe.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Home className="h-5 w-5" /> Need help?
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Re-install the agent: instructions are in your original welcome email.</p>
              <p>
                Email <a href="mailto:support@mithras.com.au" className="underline">support@mithras.com.au</a> for anything else.
                We typically respond within one business day.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  );
}
