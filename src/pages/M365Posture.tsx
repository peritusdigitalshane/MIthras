import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalStatCard } from "@/components/portal/PortalStatCard";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  ShieldCheck, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, XCircle,
  Sparkles, ExternalLink, Clock, ArrowRight, Loader2, Building2,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import {
  useLatestM365Posture, useM365TenantForOrg, useRunPostureScan, useGeneratePostureAdvice,
  useM365PostureTrend,
  type PostureStatus,
} from "@/hooks/useM365Posture";
import { formatDistanceToNow } from "date-fns";
import { parsePollError } from "@/lib/m365-error";
import { toast } from "sonner";

const CATEGORY_LABEL: Record<string, string> = {
  identity:   "Identity",
  email:      "Email",
  data:       "Data",
  apps:       "Apps & OAuth",
  governance: "Governance",
};

function StatusIcon({ status }: { status: PostureStatus }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn")    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === "fail")    return <XCircle className="h-4 w-4 text-rose-500" />;
  if (status === "error")   return <AlertCircle className="h-4 w-4 text-slate-500" />;
  return <Clock className="h-4 w-4 text-slate-400" />;
}

function StatusBadge({ status }: { status: PostureStatus }) {
  const cfg: Record<PostureStatus, { className: string; label: string }> = {
    pass:    { className: "border-emerald-500/50 text-emerald-600 bg-emerald-500/5",  label: "Pass"    },
    warn:    { className: "border-amber-500/50   text-amber-600   bg-amber-500/5",    label: "Warn"    },
    fail:    { className: "border-rose-500/50    text-rose-600    bg-rose-500/5",     label: "Fail"    },
    error:   { className: "border-slate-500/50   text-slate-600   bg-slate-500/5",    label: "Error"   },
    skipped: { className: "border-slate-300      text-slate-500   bg-slate-50/5",     label: "Skipped" },
  };
  return <Badge variant="outline" className={cfg[status].className}>{cfg[status].label}</Badge>;
}

function scoreTone(score: number | null): { bg: string; text: string; ring: string; label: string } {
  if (score === null) return { bg: "bg-slate-100", text: "text-slate-500", ring: "ring-slate-200", label: "No data" };
  if (score >= 80)    return { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200", label: "Strong" };
  if (score >= 60)    return { bg: "bg-amber-100",   text: "text-amber-700",   ring: "ring-amber-200",   label: "Needs work" };
  if (score >= 40)    return { bg: "bg-orange-100",  text: "text-orange-700",  ring: "ring-orange-200",  label: "At risk" };
  return                   { bg: "bg-rose-100",     text: "text-rose-700",    ring: "ring-rose-200",    label: "Critical" };
}

export default function M365Posture() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id ?? null;
  const { data: tenant, isLoading: tenantLoading, error: tenantError } = useM365TenantForOrg(orgId);
  const { data: latest, isLoading: latestLoading, error: latestError } = useLatestM365Posture(orgId);
  const { data: trend } = useM365PostureTrend(orgId, 30);
  const runScan = useRunPostureScan();
  const genAdvice = useGeneratePostureAdvice();
  const [adviceLocal, setAdviceLocal] = useState<typeof latest extends { advice: infer A } ? A : any>(null);

  const handleScan = async () => {
    if (!tenant) return;
    try {
      const r = await runScan.mutateAsync(tenant.id);
      toast.success(`Scan complete — ${r.pass_count} pass, ${r.warn_count} warn, ${r.fail_count} fail`);
    } catch (e: any) {
      toast.error(e.message ?? "Scan failed");
    }
  };

  const handleAdvice = async () => {
    if (!latest?.snapshot) return;
    try {
      const r = await genAdvice.mutateAsync(latest.snapshot.id);
      setAdviceLocal({ payload: r.payload } as any);
      toast.success("Fix plan ready");
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't generate fix plan");
    }
  };

  // RPC failure → show a recoverable error instead of an infinite skeleton.
  // Without this, a 500 from get_latest_m365_posture leaves the page stuck.
  const fetchError = (tenantError ?? latestError) as Error | null;
  if (fetchError && !tenantLoading && !latestLoading) {
    return (
      <MainLayout>
        <div className="p-6 max-w-3xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load M365 posture</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm">{fetchError.message ?? "An unexpected error occurred."}</p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  // No tenant connected → onboarding card
  if (!tenantLoading && !tenant) {
    return (
      <MainLayout>
        <div className="p-6 max-w-3xl mx-auto">
          <PortalEmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Connect Microsoft 365 to start auditing"
            description={
              <p>
                Mithras audits ~8 critical M365 security controls against CIS benchmarks — MFA coverage, legacy auth,
                admin sprawl, OAuth grants, sharing settings, Secure Score and more. Connect your tenant once and we'll
                scan it daily. Read-only access via Microsoft consent.
              </p>
            }
            primaryAction={{ label: "Connect M365 →", href: "/m365" }}
            secondaryAction={{ label: "Read the security overview", href: "/glossary#m365-posture" }}
          />
        </div>
      </MainLayout>
    );
  }

  const snap     = latest?.snapshot;
  const findings = latest?.findings ?? [];
  const advice   = (adviceLocal ?? latest?.advice ?? null) as any;
  const tone     = scoreTone(snap?.overall_score ?? null);
  const secPct   = snap?.secure_score_max && snap.secure_score_max > 0
    ? Math.round((snap.secure_score! / snap.secure_score_max) * 100) : null;

  // Group findings by category
  const byCategory: Record<string, typeof findings> = {};
  for (const fc of findings) {
    const cat = fc.control.category;
    (byCategory[cat] ??= []).push(fc);
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow="M365 security posture"
          eyebrowIcon={<ShieldCheck className="h-3.5 w-3.5" />}
          title={tenant?.tenant_display_name ?? "Microsoft 365 posture"}
          subtitle={
            snap
              ? `Last scanned ${formatDistanceToNow(new Date(snap.scanned_at), { addSuffix: true })}. We audit 8 high-signal controls and benchmark against Microsoft Secure Score.`
              : "Run your first scan to assess MFA coverage, admin sprawl, OAuth grants, sharing settings, and overall Secure Score."
          }
          status={snap?.overall_score == null ? undefined : {
            label: `${snap.overall_score}/100 · ${tone.label}`,
            tone:  snap.overall_score >= 75 ? "ok" : snap.overall_score >= 50 ? "warn" : "bad",
          }}
          actions={
            <div className="flex gap-2">
              <Button onClick={handleScan} disabled={runScan.isPending} className="shadow-sm">
                {runScan.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {snap ? "Re-scan now" : "Run first scan"}
              </Button>
              {snap && (
                <Button onClick={handleAdvice} disabled={genAdvice.isPending} variant="outline">
                  {genAdvice.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Generate fix plan
                </Button>
              )}
            </div>
          }
        />

        {tenant?.last_poll_error && (() => {
          const parsed = parsePollError(tenant.last_poll_error);
          // License-only — soft amber info card, not destructive
          if (parsed.licenseBlocked.length > 0 && !parsed.other) {
            return (
              <Alert className="border-amber-500/40">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertTitle>
                  {parsed.licenseBlocked.join(" + ")} needs Entra ID P1
                </AlertTitle>
                <AlertDescription className="text-xs">
                  These Graph endpoints require an Azure AD / Entra ID Premium P1 license
                  on the customer's tenant. Mailbox-rule, OAuth-grant, and policy posture
                  checks continue to run.{" "}
                  <a
                    href="https://learn.microsoft.com/entra/identity/monitoring-health/concept-sign-ins"
                    target="_blank"
                    rel="noopener"
                    className="underline"
                  >
                    Microsoft docs
                  </a>
                </AlertDescription>
              </Alert>
            );
          }
          // Mixed: license-blocked plus a real error
          if (parsed.licenseBlocked.length > 0 && parsed.other) {
            return (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Last sync had an error</AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  <div>
                    {parsed.licenseBlocked.join(" + ")} need Entra ID P1 (not blocking other checks).
                  </div>
                  <div className="font-mono">{parsed.other}</div>
                </AlertDescription>
              </Alert>
            );
          }
          // Pure non-license error — preserve original destructive treatment
          return (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Last sync had an error</AlertTitle>
              <AlertDescription className="text-xs font-mono">{tenant.last_poll_error}</AlertDescription>
            </Alert>
          );
        })()}

        {/* Trend sparkline — only when we have ≥2 snapshots */}
        {trend && trend.length >= 2 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                30-day trend
              </CardTitle>
              <CardDescription className="text-xs">
                {(() => {
                  const first = trend[0].overall_score ?? 0;
                  const last  = trend[trend.length - 1].overall_score ?? 0;
                  const delta = last - first;
                  return delta === 0
                    ? `No change vs ${trend.length} scans ago.`
                    : delta > 0
                      ? `Up ${delta} points vs ${trend.length} scans ago — keep going.`
                      : `Down ${Math.abs(delta)} points vs ${trend.length} scans ago — review recent regressions.`;
                })()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Sparkline points={trend.map(t => ({ x: new Date(t.scanned_at).getTime(), y: t.overall_score ?? 0 }))} />
            </CardContent>
          </Card>
        )}

        {/* KPIs */}
        {snap && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <PortalStatCard
              label="Overall score"
              value={snap.overall_score == null ? "—" : `${snap.overall_score}/100`}
              icon={<ShieldCheck className="h-4 w-4" />}
              hint="Weighted across 8 controls"
            />
            <PortalStatCard
              label="Secure Score"
              value={secPct == null ? "—" : `${secPct}%`}
              icon={<ShieldCheck className="h-4 w-4" />}
              hint={snap.secure_score != null ? `${snap.secure_score}/${snap.secure_score_max}` : "From Microsoft"}
            />
            <PortalStatCard
              label="Passing" value={snap.pass_count}
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              hint="Controls that look good"
            />
            <PortalStatCard
              label="Warnings" value={snap.warn_count}
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
              hint="Worth a closer look"
            />
            <PortalStatCard
              label="Failing" value={snap.fail_count} positiveIsBad
              icon={<XCircle className="h-4 w-4 text-rose-500" />}
              hint="Fix these this week"
            />
          </div>
        )}

        {/* AI advice card */}
        {advice && (
          <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI-generated fix plan
                <Badge variant="outline" className="text-[10px] capitalize">{advice.payload.risk_level} risk</Badge>
              </CardTitle>
              <CardDescription>{advice.payload.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {advice.payload.top_actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No urgent actions surfaced — keep scanning weekly.</p>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                  {advice.payload.top_actions.map((a: any, i: number) => {
                    const ctrl = findings.find(fc => fc.control.control_id === a.control_id)?.control;
                    return (
                      <AccordionItem key={i} value={`a-${i}`} className="border rounded-lg px-3">
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center justify-between gap-3 w-full pr-4">
                            <div className="text-left">
                              <div className="text-sm font-medium">{ctrl?.title ?? a.control_id}</div>
                              <div className="text-xs text-muted-foreground">{a.why_now}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className="text-[10px]"><Clock className="h-3 w-3 mr-1" />{a.est_minutes}m</Badge>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ol className="space-y-1.5 text-sm pl-4 list-decimal">
                            {a.steps.map((s: string, j: number) => <li key={j}>{s}</li>)}
                          </ol>
                          {ctrl?.remediation_url && (
                            <Button asChild size="sm" variant="ghost" className="mt-3">
                              <a href={ctrl.remediation_url} target="_blank" rel="noopener">
                                Microsoft docs <ExternalLink className="h-3.5 w-3.5 ml-1" />
                              </a>
                            </Button>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
              {advice.payload.shoutouts.length > 0 && (
                <div className="border-t pt-3">
                  <div className="text-xs text-muted-foreground mb-1">You're doing well here:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {advice.payload.shoutouts.map((cid: string) => {
                      const ctrl = findings.find(fc => fc.control.control_id === cid)?.control;
                      return ctrl ? <Badge key={cid} variant="outline" className="border-emerald-500/40 text-emerald-700 text-xs">{ctrl.title}</Badge> : null;
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Per-category controls */}
        {!snap && !latestLoading ? (
          <PortalEmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title="No scan yet"
            description={<p>Click "Run first scan" above. The audit takes about 30 seconds and produces a per-control report you can act on immediately.</p>}
            className="border-0 shadow-none"
          />
        ) : latestLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          ["identity", "apps", "data", "governance", "email"].map(cat => {
            const items = byCategory[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <Card key={cat}>
                <CardHeader>
                  <CardTitle className="text-base">{CATEGORY_LABEL[cat]}</CardTitle>
                  <CardDescription>{items.length} control{items.length === 1 ? "" : "s"} audited</CardDescription>
                </CardHeader>
                <CardContent className="divide-y">
                  {items.map(({ finding, control }) => {
                    const t = scoreTone(finding.status === "error" ? null : finding.score);
                    return (
                      <div key={finding.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <StatusIcon status={finding.status} />
                            <div className="min-w-0">
                              <div className="font-medium text-sm">{control.title}</div>
                              <div className="text-xs text-muted-foreground">{control.description}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge status={finding.status} />
                            <Badge variant="outline" className={`text-xs ${t.text}`}>{finding.score}/100</Badge>
                          </div>
                        </div>

                        {finding.status === "error" && finding.error_message && (
                          <Alert variant="destructive" className="mt-2">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <AlertDescription className="text-xs font-mono">{finding.error_message}</AlertDescription>
                          </Alert>
                        )}

                        {finding.status === "skipped" && (() => {
                          const d = finding.details as Record<string, unknown> | undefined;
                          const reason = typeof d?.reason === "string" ? d.reason : null;
                          const missing = typeof d?.missing_scope === "string" ? d.missing_scope : null;
                          const hint = typeof d?.hint === "string" ? d.hint : null;
                          if (!reason && !hint) return null;
                          return (
                            <div className="mt-2 ml-6 text-xs text-muted-foreground space-y-1">
                              {reason === "requires_entra_id_p1" && (
                                <div>
                                  ● Needs <strong>Entra ID P1</strong> on the customer tenant. Other controls keep running.
                                </div>
                              )}
                              {reason === "missing_app_permission" && (
                                <div>
                                  ● Needs <code className="px-1 py-0.5 bg-muted rounded">{missing ?? "an additional Graph scope"}</code> on the Mithras app registration. Add it in Azure AD → App registrations → Mithras → API permissions, then click <em>Grant admin consent</em>.
                                </div>
                              )}
                              {reason && !["requires_entra_id_p1", "missing_app_permission"].includes(reason) && hint && (
                                <div>● {hint}</div>
                              )}
                            </div>
                          );
                        })()}

                        {finding.status !== "error" && finding.status !== "skipped" && (
                          <div className="mt-2 ml-6 text-xs text-muted-foreground">
                            {renderDetails(control.control_id, finding.details)}
                          </div>
                        )}

                        {control.remediation_url && (finding.status === "fail" || finding.status === "warn") && (
                          <div className="ml-6 mt-2 flex items-center gap-3">
                            <span className="text-xs text-muted-foreground italic">{control.impact_if_failed}</span>
                            <Button asChild size="sm" variant="ghost" className="text-xs h-7">
                              <a href={control.remediation_url} target="_blank" rel="noopener">
                                Fix steps <ArrowRight className="h-3 w-3 ml-1" />
                              </a>
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </MainLayout>
  );
}

// Inline SVG sparkline. Lightweight, no chart dependency. Auto-scales x and y.
function Sparkline({ points }: { points: Array<{ x: number; y: number }> }) {
  if (points.length < 2) return null;
  const W = 800, H = 64, PAD = 4;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = 100;
  const sx = (x: number) => PAD + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const lastY = points[points.length - 1].y;
  const stroke = lastY >= 75 ? "stroke-emerald-500" : lastY >= 50 ? "stroke-amber-500" : "stroke-rose-500";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-16">
      <line x1={PAD} y1={sy(75)} x2={W - PAD} y2={sy(75)} className="stroke-emerald-400/30" strokeDasharray="3 3" strokeWidth="1" />
      <line x1={PAD} y1={sy(50)} x2={W - PAD} y2={sy(50)} className="stroke-amber-400/30"   strokeDasharray="3 3" strokeWidth="1" />
      <path d={d} fill="none" className={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === points.length - 1 ? 3 : 1.5} className={stroke} fill="currentColor" />
      ))}
    </svg>
  );
}

function renderDetails(controlId: string, details: Record<string, unknown>): string {
  switch (controlId) {
    case "identity.mfa_coverage":
      return `${details.mfa_registered ?? 0} of ${details.total_users ?? 0} users have MFA registered (${details.coverage_pct ?? 0}%)`;
    case "identity.legacy_auth_blocked":
      return (details.policy_name as string) ? `Blocked by Conditional Access policy "${details.policy_name}"` : "No blocking policy found";
    case "identity.global_admin_count":
      return `${details.global_admin_count ?? 0} global administrator(s). Recommended: ${details.recommended_range ?? "2-4"}`;
    case "identity.guest_user_sprawl":
      return `${details.total_guests ?? 0} guests; ${details.stale_90d_count ?? 0} (${details.stale_pct ?? 0}%) haven't signed in for 90+ days`;
    case "apps.user_consent_disabled":
      return (details.granted_policies as any[])?.length === 0 ? "User app consent is disabled" : "User app consent is permitted — recommend disabling";
    case "apps.risky_oauth_grants":
      return `${details.risky_count ?? 0} of ${details.total_grants ?? 0} grants include high-risk scopes`;
    case "data.sharepoint_external_sharing":
      return `Sharing capability: "${details.sharing_capability}"`;
    case "governance.secure_score":
      return `${details.current_score} / ${details.max_score} (${details.pct}%)${details.comparative_average ? ` · industry avg ${Math.round(details.comparative_average as number)}` : ""}`;
    case "email.external_forwarding_blocked":
      return details.auto_forward_enabled === false
        ? "External auto-forwarding is blocked at the Remote Domain default policy."
        : `External auto-forwarding currently ${details.auto_forward_enabled === true ? "PERMITTED" : "unknown"} — this is the #1 BEC persistence vector.`;
    case "apps.stale_app_registrations":
      return `${details.stale_count ?? 0} of ${details.total_apps ?? 0} app registrations (${details.stale_pct ?? 0}%) were created >90 days ago and may be unused`;
    case "governance.audit_log_enabled":
      return (details.error as string)
        ? `Audit log query failed — may be disabled. ${(details.error as string).slice(0, 100)}`
        : "Unified audit log is enabled and readable.";
    default:
      return JSON.stringify(details).slice(0, 200);
  }
}
