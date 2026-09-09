import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck, RefreshCcw, AlertTriangle, ExternalLink, Eye, EyeOff,
  CheckCircle2, Lock, Cloud, ChevronDown, ChevronRight,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCaOverview, useCaPolicies, useCaFindings,
  useRefreshCa, useAcknowledgeCaFinding,
  type CaPolicy, type CaFinding,
} from "@/hooks/useConditionalAccess";

// SOC operator view of Microsoft Entra Conditional Access policies, plus an
// AI gap analysis against best-practice patterns. Read-only — clicking
// "Fix in Entra" deep-links to the customer's own Entra admin centre.
// We never edit policies from this page; the blast radius of a bad CA
// change is "lock the tenant out", so the admin makes the change with
// their own eyes on the Microsoft confirmation dialog.

const SEV_TONE: Record<CaFinding["severity"], { ring: string; text: string; bg: string; label: string }> = {
  critical: { ring: "border-status-critical/40", text: "text-status-critical", bg: "bg-status-critical/10", label: "Critical" },
  high:     { ring: "border-orange-500/40",      text: "text-orange-500",      bg: "bg-orange-500/10",      label: "High" },
  medium:   { ring: "border-amber-500/40",       text: "text-amber-500",       bg: "bg-amber-500/10",       label: "Medium" },
  low:      { ring: "border-muted-foreground/40",text: "text-muted-foreground",bg: "bg-muted/30",           label: "Low" },
  info:     { ring: "border-muted-foreground/40",text: "text-muted-foreground",bg: "bg-muted/30",           label: "Info" },
};

const STATE_LABEL: Record<string, string> = {
  enabled:                            "Enforced",
  disabled:                           "Disabled",
  enabledForReportingNotEnforced:     "Report-only",
};

const STATE_TONE: Record<string, string> = {
  enabled:                            "border-emerald-500/40 text-emerald-500",
  disabled:                           "border-muted-foreground/40 text-muted-foreground",
  enabledForReportingNotEnforced:     "border-amber-500/40 text-amber-500",
};

export default function ConditionalAccessPage() {
  const overview  = useCaOverview();
  const policies  = useCaPolicies();
  const findings  = useCaFindings();
  const refresh   = useRefreshCa();
  const ack       = useAcknowledgeCaFinding();
  const [showAck, setShowAck] = useState(false);

  const o = overview.data;
  const noTenants = !overview.isLoading && (o?.tenant_count ?? 0) === 0;
  const noPolicies = !overview.isLoading && (o?.tenant_count ?? 0) > 0 && (o?.policies_total ?? 0) === 0 && !o?.last_fetched_at;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Conditional Access
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Read-only view of every connected M365 tenant's Conditional Access policies, with an
              AI gap analysis against best-practice patterns. Mithras does not modify policies — we
              link straight into the Microsoft Entra admin centre so your M365 admin makes the
              change themselves.
            </p>
          </div>
          <Button
            onClick={() => refresh.mutate({})}
            disabled={refresh.isPending}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
            {refresh.isPending ? "Refreshing…" : "Refresh now"}
          </Button>
        </div>

        {/* Counter strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Tenants" value={o?.tenant_count ?? "—"} icon={<Cloud className="h-3.5 w-3.5" />} />
          <Kpi label="Policies" value={o?.policies_total ?? "—"} icon={<Lock className="h-3.5 w-3.5" />} />
          <Kpi label="Enforced" value={o?.policies_enabled ?? "—"} icon={<CheckCircle2 className="h-3.5 w-3.5" />} accent={(o?.policies_enabled ?? 0) > 0 ? "ok" : undefined} />
          <Kpi label="Report-only" value={o?.policies_report_only ?? "—"} icon={<Eye className="h-3.5 w-3.5" />} accent={(o?.policies_report_only ?? 0) > 0 ? "warn" : undefined} />
          <Kpi
            label="Open findings"
            value={o?.findings_open ?? "—"}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            accent={
              (o?.findings_critical ?? 0) > 0 ? "danger" :
              (o?.findings_open ?? 0) > 0      ? "warn"   : undefined
            }
            sub={(o?.findings_critical ?? 0) > 0 ? `${o?.findings_critical} critical` : undefined}
          />
        </div>

        <div className="text-[10px] text-muted-foreground">
          {o?.last_fetched_at
            ? `Last refreshed ${formatDistanceToNow(new Date(o.last_fetched_at), { addSuffix: true })}. Daily auto-refresh at 03:17 UTC.`
            : "No refresh on record yet."}
        </div>

        {/* Empty states */}
        {noTenants && (
          <Card><CardContent className="p-8 text-center">
            <Cloud className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="font-medium text-sm">No M365 tenant connected</div>
            <div className="text-xs text-muted-foreground mt-1">
              Connect a Microsoft 365 tenant from <a href="/m365" className="underline">/m365</a> to start auditing Conditional Access.
            </div>
          </CardContent></Card>
        )}
        {noPolicies && (
          <Card><CardContent className="p-8 text-center">
            <RefreshCcw className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <div className="font-medium text-sm">No data yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Click <b>Refresh now</b> to pull this tenant's Conditional Access policies and run the AI gap analysis.
            </div>
          </CardContent></Card>
        )}

        {/* AI findings */}
        {!noTenants && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">AI gap analysis</h2>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowAck(!showAck)}>
                {showAck ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showAck ? "Hide acknowledged" : "Show acknowledged"}
              </Button>
            </div>
            {findings.isLoading ? (
              <Card><CardContent className="p-4"><Skeleton className="h-20" /></CardContent></Card>
            ) : (findings.data ?? []).length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm">
                <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
                <div className="font-medium">No open findings</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Either the AI analysis hasn't run yet (try Refresh now), or your policies pass every best-practice check.
                </div>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {(findings.data ?? []).map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    policies={policies.data ?? []}
                    onAck={(note) => ack.mutate({ findingId: f.id, note })}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Policies list */}
        {!noTenants && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Active policies</h2>
            {policies.isLoading ? (
              <Card><CardContent className="p-4 space-y-2">
                <Skeleton className="h-12" /><Skeleton className="h-12" />
              </CardContent></Card>
            ) : (policies.data ?? []).length === 0 ? null : (
              <div className="space-y-1.5">
                {(policies.data ?? []).map((p) => (
                  <PolicyRow key={p.id} policy={p} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </MainLayout>
  );
}

function Kpi({ label, value, icon, sub, accent }: {
  label: string; value: number | string;
  icon: React.ReactNode; sub?: string;
  accent?: "ok" | "warn" | "danger";
}) {
  const accentClass =
    accent === "danger" ? "text-status-critical" :
    accent === "warn"   ? "text-amber-500"       :
    accent === "ok"     ? "text-emerald-500"     : "";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={`text-2xl font-bold tabular-nums ${accentClass}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function FindingCard({
  finding, policies, onAck,
}: {
  finding: CaFinding;
  policies: CaPolicy[];
  onAck: (note?: string) => void;
}) {
  const tone = SEV_TONE[finding.severity];
  const related = finding.related_policy_ids
    .map((id) => policies.find((p) => p.policy_id === id))
    .filter(Boolean) as CaPolicy[];
  return (
    <Card className={tone.ring}>
      <CardContent className={`p-4 ${tone.bg}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={`h-4 w-4 mt-0.5 ${tone.text}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant="outline" className={`text-[10px] ${tone.ring} ${tone.text}`}>{tone.label}</Badge>
              {finding.acknowledged_at && (
                <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground">
                  acknowledged
                </Badge>
              )}
            </div>
            <div className="font-medium text-sm">{finding.title}</div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{finding.body}</p>
            <div className="mt-2 text-xs">
              <span className="font-medium">Fix:</span>{" "}
              <span className="text-muted-foreground">{finding.recommended_action}</span>
            </div>
            {related.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Related:</span>
                {related.map((p) => (
                  <Badge key={p.id} variant="outline" className="text-[10px]">{p.display_name}</Badge>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                <a href={finding.entra_deep_link} target="_blank" rel="noopener noreferrer">
                  Fix in Entra <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
              {!finding.acknowledged_at && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAck()}>
                  Acknowledge
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyRow({ policy }: { policy: CaPolicy }) {
  const [open, setOpen] = useState(false);
  const stateClass = STATE_TONE[policy.state] ?? "border-muted-foreground/40 text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <span className="font-medium text-sm truncate">{policy.display_name}</span>
            <Badge variant="outline" className={`text-[10px] ${stateClass}`}>
              {STATE_LABEL[policy.state] ?? policy.state}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            modified {policy.modified_datetime ? formatDistanceToNow(new Date(policy.modified_datetime), { addSuffix: true }) : "unknown"}
          </span>
        </button>
        {open && (
          <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <Block title="Conditions" json={policy.conditions} />
            <Block title="Grant controls" json={policy.grant_controls} />
            {policy.session_controls && (
              <Block title="Session controls" json={policy.session_controls} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Block({ title, json }: { title: string; json: unknown }) {
  if (!json || (typeof json === "object" && Object.keys(json as Record<string, unknown>).length === 0)) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
        <div className="text-muted-foreground">(none)</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      <pre className="text-[10px] leading-tight font-mono bg-muted/30 rounded p-2 overflow-x-auto max-h-40">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}
