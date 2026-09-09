import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Seo } from "@/components/seo/Seo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, CreditCard, Mail, LogOut, ShieldCheck, AlertCircle, ExternalLink,
  Copy, Check, Monitor, KeyRound, Terminal, ShieldAlert, Activity,
  Bug, Lock, Wifi, Eye, FileText, Clock, Sparkles, Zap, AlertTriangle,
} from "lucide-react";
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

interface EndpointRow {
  id: string;
  hostname: string | null;
  last_seen_at: string | null;
  is_active: boolean | null;
  os_version: string | null;
  agent_version: string | null;
}

interface EndpointStatusRow {
  endpoint_id: string;
  collected_at: string;
  real_time_protection: boolean | null;
  behavior_monitor_enabled: boolean | null;
  antivirus_enabled: boolean | null;
  signature_age_days: number | null;
}

interface ThreatRow {
  id: string;
  endpoint_id: string;
  threat_name: string | null;
  severity: string | null;
  detection_time: string | null;
  action_success: boolean | null;
}

interface TokenRow { token: string; max_uses: number; use_count: number; expires_at: string | null }

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

function buildInstallCommand(token: string): string {
  const base = "https://api.mithras.com.au/storage/v1/object/public/agent-bundles/install-personal.ps1";
  return `iwr -UseBasicParsing "${base}" | iex; Install-MithrasPersonal -Code "${token}"`;
}

interface ProtectionLayer { icon: React.ReactNode; title: string; description: string; }

const PROTECTION_LAYERS: ProtectionLayer[] = [
  { icon: <ShieldCheck className="h-5 w-5" />, title: "Microsoft Defender hardened", description: "All 16 ASR rules enabled. Behaviour monitoring, real-time protection, cloud-delivered detection — all enforced." },
  { icon: <Lock className="h-5 w-5" />,         title: "Ransomware shield",          description: "Microsoft Defender's behaviour monitoring and Controlled Folder Access are enforced by Mithras. Suspicious encryption patterns are blocked before files are damaged." },
  { icon: <Bug className="h-5 w-5" />,          title: "Vulnerability scanning",     description: "We check every installed app against the CVE database. Critical patches are flagged on your monthly report." },
  { icon: <Eye className="h-5 w-5" />,          title: "Behaviour intelligence",     description: "Suspicious process trees, credential theft attempts, LSASS access — flagged in real-time, not after the fact." },
  { icon: <Wifi className="h-5 w-5" />,         title: "Firewall hardening",         description: "Inbound services locked down. SMB, RDP and remote-management ports closed unless you actually use them." },
  { icon: <Activity className="h-5 w-5" />,     title: "24/7 monitoring",            description: "Your PC reports in continuously. If anything serious is found, you get an email instantly." },
];

const SEV_TONE: Record<string, string> = {
  Severe:   "bg-rose-500/15 text-rose-600 border-rose-500/30",
  High:     "bg-orange-500/15 text-orange-600 border-orange-500/30",
  Moderate: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  Low:      "bg-slate-500/15 text-slate-600 border-slate-500/30",
};

export default function HomeUserAccount() {
  const { user } = useAuth();
  const { currentOrganization } = useTenant();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [row, setRow] = useState<HomeOrgRow | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [endpointStatus, setEndpointStatus] = useState<Map<string, EndpointStatusRow>>(new Map());
  const [recentThreats, setRecentThreats] = useState<ThreatRow[]>([]);
  const [token, setToken] = useState<TokenRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [copied, setCopied] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    if (!currentOrganization?.id) return;
    let cancelled = false;
    (async () => {
      const [orgRes, epRes, tokRes] = await Promise.all([
        supabase.from("organizations").select("id, name, home_user_email, stripe_status, stripe_current_period_end, is_active").eq("id", currentOrganization.id).maybeSingle(),
        supabase.from("endpoints").select("id, hostname, last_seen_at, is_active, os_version, agent_version").eq("organization_id", currentOrganization.id).order("last_seen_at", { ascending: false }),
        supabase.from("enrollment_tokens").select("token, max_uses, use_count, expires_at").eq("organization_id", currentOrganization.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (orgRes.data) setRow(orgRes.data as HomeOrgRow);
      if (tokRes.data) setToken(tokRes.data as TokenRow);
      const eps = (epRes.data ?? []) as EndpointRow[];
      setEndpoints(eps);

      // Pull latest status + recent threats per endpoint
      if (eps.length > 0) {
        const ids = eps.map(e => e.id);
        const [statusRes, threatsRes] = await Promise.all([
          supabase.from("endpoint_status").select("endpoint_id, collected_at, real_time_protection, behavior_monitor_enabled, antivirus_enabled, signature_age_days").in("endpoint_id", ids).order("collected_at", { ascending: false }),
          supabase.from("endpoint_threats").select("id, endpoint_id, threat_name, severity, detection_time, action_success").in("endpoint_id", ids).order("detection_time", { ascending: false }).limit(10),
        ]);
        if (cancelled) return;
        const latest = new Map<string, EndpointStatusRow>();
        for (const r of ((statusRes.data ?? []) as EndpointStatusRow[])) {
          if (!latest.has(r.endpoint_id)) latest.set(r.endpoint_id, r);
        }
        setEndpointStatus(latest);
        setRecentThreats((threatsRes.data ?? []) as ThreatRow[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentOrganization?.id]);

  const activeEndpoints = useMemo(() => endpoints.filter(e => e.is_active !== false), [endpoints]);
  const hasEndpoint = activeEndpoints.length > 0;
  const installCommand = token ? buildInstallCommand(token.token) : "";
  const tokenAvailable = token && token.use_count < token.max_uses;

  // Security score: 0-100. Reflects whether key Defender layers are active
  // across every device; a missing device is the only thing that takes the
  // hero number out of "100".
  const score = useMemo(() => {
    if (!hasEndpoint) return 0;
    let total = 0; let count = 0;
    for (const ep of activeEndpoints) {
      const s = endpointStatus.get(ep.id);
      let local = 0;
      if (s?.real_time_protection)     local += 30;
      if (s?.behavior_monitor_enabled) local += 25;
      if (s?.antivirus_enabled)        local += 25;
      if (s && (s.signature_age_days ?? 99) <= 2) local += 20;
      total += local; count += 1;
    }
    return count === 0 ? 0 : Math.round(total / count);
  }, [activeEndpoints, endpointStatus, hasEndpoint]);

  // Tailwind purges unused classes, so dynamic template-literal class names
  // like `border-${tone}-500/30` won't compile. Use static lookups so every
  // class string is detectable by Tailwind's content scanner.
  const toneStyles = (() => {
    if (!hasEndpoint) return {
      hero: "border-slate-500/30 bg-gradient-to-br from-slate-500/5 via-background to-background",
      ring: "border-slate-500/40 bg-slate-500/5",
      num:  "text-slate-600",
    };
    if (score >= 80) return {
      hero: "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-background to-background",
      ring: "border-emerald-500/40 bg-emerald-500/5",
      num:  "text-emerald-600",
    };
    if (score >= 60) return {
      hero: "border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background",
      ring: "border-amber-500/40 bg-amber-500/5",
      num:  "text-amber-600",
    };
    return {
      hero: "border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-background to-background",
      ring: "border-rose-500/40 bg-rose-500/5",
      num:  "text-rose-600",
    };
  })();
  const heroText = !hasEndpoint
    ? { title: "Welcome — finish setup to activate", subtitle: "Your subscription is live. Install Mithras on one Windows PC to start being protected." }
    : score >= 80
      ? { title: "You're protected",   subtitle: `Mithras is actively defending ${activeEndpoints.length} ${activeEndpoints.length === 1 ? "device" : "devices"}.` }
      : { title: "Needs attention",    subtitle: "Some protection layers aren't on. See your devices below." };

  const copyInstall = async () => {
    if (!token) return;
    try { await navigator.clipboard.writeText(buildInstallCommand(token.token)); setCopied(true); setTimeout(() => setCopied(false), 2500); toast({ title: "Copied", description: "Paste into PowerShell (Run as Administrator)." }); } catch {}
  };

  const setPassword = async () => {
    if (newPassword.length < 8) { toast({ title: "Password too short", description: "At least 8 characters.", variant: "destructive" }); return; }
    if (newPassword !== confirmPassword) { toast({ title: "Passwords don't match", description: "Type the same password in both boxes.", variant: "destructive" }); return; }
    setSettingPassword(true);
    try { const { error } = await supabase.auth.updateUser({ password: newPassword }); if (error) throw error; toast({ title: "Password set" }); setNewPassword(""); setConfirmPassword(""); }
    catch (e: any) { toast({ title: "Couldn't set password", description: e?.message, variant: "destructive" }); }
    finally { setSettingPassword(false); }
  };

  const openPortal = async () => {
    setOpeningPortal(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error("Not signed in");
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const resp = await fetch(`${supabaseUrl}/functions/v1/stripe-customer-portal`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` } });
      const j = await resp.json();
      if (!resp.ok) {
        if (j.error === "stripe_not_configured") { toast({ title: "Subscription management not available yet", description: "Email support@mithras.com.au.", variant: "destructive" }); return; }
        if (j.error === "no_home_user_subscription") { toast({ title: "No subscription found", description: "Email support@mithras.com.au.", variant: "destructive" }); return; }
        throw new Error(j.details ?? j.error ?? `HTTP ${resp.status}`);
      }
      window.location.href = j.url;
    } catch (e: any) { toast({ title: "Couldn't open subscription portal", description: e.message, variant: "destructive" }); }
    finally { setOpeningPortal(false); }
  };

  const signOut = async () => { await supabase.auth.signOut(); navigate("/"); };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const status = row?.stripe_status ?? "unknown";
  const statusMeta = STATUS_LABEL[status] ?? { label: status, tone: "warn" as const };
  const periodEnd = row?.stripe_current_period_end ? new Date(row.stripe_current_period_end) : null;
  const nextReportDate = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d; })();

  return (
    <>
      <Seo title="My Mithras — your security dashboard" description="Live security status, device health and recent activity for your Mithras Personal subscription." />
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
        <header className="border-b backdrop-blur-md bg-background/60 sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span className="font-semibold">Mithras</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">· Personal</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-mono">{row?.home_user_email ?? user?.email ?? ""}</Badge>
              <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4 mr-1.5" />Sign out</Button>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* HERO — security status + score */}
          <Card className={`overflow-hidden ${toneStyles.hero}`}>
            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row gap-6 sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusMeta.tone === "ok" ? "default" : statusMeta.tone === "warn" ? "secondary" : "destructive"}>
                      Subscription · {statusMeta.label}
                    </Badge>
                    {periodEnd && status !== "canceled" && (
                      <Badge variant="outline" className="text-[10px]">Next bill {periodEnd.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Badge>
                    )}
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{heroText.title}</h1>
                  <p className="text-sm text-muted-foreground max-w-md">{heroText.subtitle}</p>
                </div>
                {hasEndpoint && (
                  <div className="text-center sm:text-right">
                    <div className={`inline-flex flex-col items-center justify-center h-28 w-28 rounded-full border-4 ${toneStyles.ring}`}>
                      <div className={`text-3xl font-bold ${toneStyles.num}`}>{score}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Security score</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* SETUP — install card, only when no endpoint */}
          {!hasEndpoint && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="h-4 w-4 text-primary" /> Install on your Windows PC
                </CardTitle>
                <CardDescription className="text-xs">
                  Open <strong>PowerShell as Administrator</strong>, paste this, press Enter. Takes ~3 minutes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {tokenAvailable ? (
                  <>
                    <div className="relative">
                      <pre className="bg-[#0b0c0e] text-emerald-400 p-3 pr-16 rounded-md text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">{installCommand}</pre>
                      <Button size="sm" variant="secondary" className="absolute top-1.5 right-1.5" onClick={copyInstall}>
                        {copied ? <><Check className="h-3.5 w-3.5 mr-1" />Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" />Copy</>}
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Code <span className="font-mono font-semibold">{token!.token}</span>
                      {token!.expires_at && ` · valid until ${new Date(token!.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`}
                      {" · single-use"}
                    </div>
                  </>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Code already used</AlertTitle>
                    <AlertDescription>Your enrolment code was redeemed. If your PC isn't showing up below within a minute, email <a href="mailto:support@mithras.com.au" className="underline">support</a>.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Critical alerts */}
          {status === "past_due" && (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Payment past due</AlertTitle><AlertDescription>Update your card under "Subscription" below.</AlertDescription></Alert>
          )}
          {status === "canceled" && (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Subscription cancelled</AlertTitle><AlertDescription>Protection ends at the next heartbeat. Re-subscribe at <a className="underline" href="/personal">/personal</a>.</AlertDescription></Alert>
          )}

          {/* DEVICES — the meat of the dashboard */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base"><Monitor className="h-4 w-4" /> Your devices</CardTitle>
                {hasEndpoint && <Badge variant="outline" className="text-[10px]">{activeEndpoints.length} active</Badge>}
              </div>
              <CardDescription className="text-xs">Each PC where Mithras is installed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!hasEndpoint ? (
                <div className="py-6 text-center space-y-2">
                  <Monitor className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">No devices yet. Run the install command above to add your first PC.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeEndpoints.map(e => {
                    const s = endpointStatus.get(e.id);
                    const lastSeenAgo = e.last_seen_at ? Date.now() - new Date(e.last_seen_at).getTime() : Infinity;
                    const stale = lastSeenAgo > 30 * 60 * 1000;
                    return (
                      <div key={e.id} className="rounded-lg border p-3 sm:p-4 space-y-2">
                        <div className="flex items-start justify-between flex-wrap gap-2">
                          <div>
                            <div className="font-medium">{e.hostname ?? "Unnamed device"}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                              {e.os_version && <span>{e.os_version}</span>}
                              {e.agent_version && <span>· Agent {e.agent_version}</span>}
                              <span>· Last reported {e.last_seen_at ? new Date(e.last_seen_at).toLocaleString() : "never"}</span>
                            </div>
                          </div>
                          <Badge variant={stale ? "destructive" : "default"} className={!stale ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" : ""}>
                            {stale ? "Stale" : "Online"}
                          </Badge>
                        </div>
                        {s && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t">
                            <PostureCell label="Real-time AV"     ok={s.real_time_protection ?? false} />
                            <PostureCell label="Behaviour monitor" ok={s.behavior_monitor_enabled ?? false} />
                            <PostureCell label="Antivirus"        ok={s.antivirus_enabled ?? false} />
                            <PostureCell label={`Signatures ${s.signature_age_days != null ? `${s.signature_age_days}d` : "?"}`} ok={(s.signature_age_days ?? 99) <= 2} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* RECENT ACTIVITY — threats with severity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Recent security activity</CardTitle>
              <CardDescription className="text-xs">Last 10 detections across your devices.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentThreats.length === 0 ? (
                <div className="py-6 text-center space-y-2">
                  <ShieldCheck className="h-8 w-8 text-emerald-500/40 mx-auto" />
                  <p className="text-sm text-muted-foreground">{hasEndpoint ? "All quiet. No threats detected." : "Nothing yet — install Mithras to start collecting."}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentThreats.map(t => (
                    <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.threat_name ?? "Unknown"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.detection_time ? new Date(t.detection_time).toLocaleString() : "—"}
                          {t.action_success != null && (
                            <> · {t.action_success ? <span className="text-emerald-600">Blocked</span> : <span className="text-rose-600">Not actioned</span>}</>
                          )}
                        </div>
                      </div>
                      {t.severity && <Badge variant="outline" className={SEV_TONE[t.severity] ?? ""}>{t.severity}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PROTECTION LAYERS — explains what we do, even with no data */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> What Mithras is protecting</CardTitle>
              <CardDescription className="text-xs">Layers active on every device you install Mithras on.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {PROTECTION_LAYERS.map(l => (
                  <div key={l.title} className="flex gap-3 p-3 rounded-md border bg-card/30">
                    <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">{l.icon}</div>
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium">{l.title}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{l.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* REPORTS + ACCOUNT */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Reports */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Monthly report</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Next report: {nextReportDate.toLocaleDateString(undefined, { day: "numeric", month: "long" })}
                </div>
                <p className="text-[12px] text-muted-foreground leading-snug">A summary email of every detection, blocked threat, and posture change — first of every month.</p>
              </CardContent>
            </Card>

            {/* Subscription */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4" /> Subscription</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm flex items-center justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium">Personal · $6 / mo</span>
                </div>
                <div className="text-sm flex items-center justify-between">
                  <span className="text-muted-foreground">{status === "canceled" ? "Access ends" : "Renews"}</span>
                  <span className="font-medium">{periodEnd ? periodEnd.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
                </div>
                <Button onClick={openPortal} disabled={openingPortal} variant="outline" size="sm" className="w-full mt-2">
                  {openingPortal ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Opening Stripe…</> : <><ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Update card · Invoices · Cancel</>}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* ACCOUNT SETTINGS — password */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Sign-in method</CardTitle>
              <CardDescription className="text-xs">You can sign in with a magic email link (default) or set a password to use email + password sign-in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="np">New password</Label>
                  <Input id="np" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp">Confirm</Label>
                  <Input id="cp" type="password" autoComplete="new-password" placeholder="Re-enter" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <Button onClick={setPassword} disabled={settingPassword || !newPassword || !confirmPassword} size="sm">
                {settingPassword ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</> : <>Save password</>}
              </Button>
            </CardContent>
          </Card>

          {/* HELP */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4" /> Need help?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Email <a href="mailto:support@mithras.com.au" className="underline">support@mithras.com.au</a> — Australian-based, typically a reply within one business day. For active threats Mithras has detected, you'll receive an email with details and recommended next steps.
            </CardContent>
          </Card>

        </main>
      </div>
    </>
  );
}

function PostureCell({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {ok ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />}
      <span className={ok ? "text-foreground" : "text-amber-600"}>{label}</span>
    </div>
  );
}
