import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ShieldAlert, Sparkles, AlertCircle, CheckCircle2, Pencil, Save, X, Activity, Coins, TrendingUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import {
  useAiModelRates, useUpdateAiModelRate,
  useAiCostBudgets, useUpsertAiCostBudget,
  useAiMonthSpend, useAiCostBreakdown, useAiRecentCalls,
  formatUsd, formatCentsUsd,
  type AiCostBudget,
} from "@/hooks/useAiCosts";
import { formatDistanceToNow } from "date-fns";

function monthStart() {
  const d = new Date();
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
function nowIso() { return new Date().toISOString(); }

const FEATURE_LABEL: Record<string, string> = {
  triage:              "Triage",
  investigation:       "Investigation",
  posture_advisor:     "M365 posture",
  cve_scan:            "CVE scan",
  cve_protect:         "CVE protect",
  cve_mitigation:      "CVE mitigation",
  security_advisor:    "Security advisor",
  report_exec_summary: "Report exec summary",
  incident_triage:     "Incident triage",
  other:               "Other",
};

export default function AdminAiCosts() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();

  const { data: rates,    isLoading: ratesLoading,    error: ratesErr  } = useAiModelRates();
  const { data: budgets,  isLoading: budgetsLoading,  error: budgetsErr } = useAiCostBudgets();
  const { data: monthSpend, isLoading: spendLoading } = useAiMonthSpend();
  const { data: breakdown,  isLoading: breakdownLoading } = useAiCostBreakdown(monthStart(), nowIso());
  const { data: recent,     isLoading: recentLoading } = useAiRecentCalls(50);

  const updateRate  = useUpdateAiModelRate();
  const upsertBudget = useUpsertAiCostBudget();

  const globalBudget = useMemo<AiCostBudget | undefined>(
    () => budgets?.find((b) => b.organization_id === null),
    [budgets],
  );
  const globalSpend = useMemo(
    () => monthSpend?.find((m) => m.scope_org_id === null),
    [monthSpend],
  );

  if (tenantLoading) return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>AI cost management is a Peritus operator concern.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Platform / AI costs</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-1">AI cost & budgets <span className="text-sm font-normal text-muted-foreground">(USD)</span></h1>
          <p className="text-sm text-muted-foreground mt-1">
            Editable per-model rates, monthly budget with alerting, and a ledger of every LLM call across triage, investigation, posture advice, CVE scans and report summaries. All amounts in USD — OpenAI bills in USD.
          </p>
        </div>

        {/* Hero: this-month spend vs global budget */}
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardContent className="p-6">
            {spendLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : globalSpend ? (
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">This month ({globalSpend.current_month})</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">{formatCentsUsd(globalSpend.spent_cents)}</div>
                  <div className="text-xs text-muted-foreground">{Number(globalSpend.spent_microcents).toLocaleString()} µ¢ across all features</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Budget</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">{formatCentsUsd(globalSpend.budget_cents)}</div>
                  <Progress value={Math.min(100, Number(globalSpend.pct_of_budget ?? 0))} className="mt-2" />
                  <div className="text-xs text-muted-foreground mt-1">{(Number(globalSpend.pct_of_budget ?? 0)).toFixed(1)}% used</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Alerting</div>
                  <div className="flex items-center gap-2 mt-2">
                    {globalSpend.alert_80_sent_at
                      ? <Badge variant="outline" className="border-amber-500 text-amber-600"><AlertCircle className="h-3 w-3 mr-1" />80% fired</Badge>
                      : <Badge variant="outline"><CheckCircle2 className="h-3 w-3 mr-1" />80% armed</Badge>}
                    {globalSpend.alert_100_sent_at
                      ? <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />100% fired</Badge>
                      : <Badge variant="outline"><CheckCircle2 className="h-3 w-3 mr-1" />100% armed</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">Reset automatically when {globalSpend.current_month} rolls over.</p>
                </div>
              </div>
            ) : (
              <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>No global budget configured.</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>

        {/* Per-feature this-month breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Coins className="h-4 w-4 text-primary" /> Spend by feature (this month)</CardTitle>
            <CardDescription>One row per feature × org. Sorted by spend desc.</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownLoading ? <Skeleton className="h-32 w-full" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Prompt tokens</TableHead>
                    <TableHead className="text-right">Completion tokens</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Avg latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(breakdown ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-6">No LLM calls this month yet.</TableCell></TableRow>
                  ) : (breakdown ?? []).map((r, i) => (
                    <TableRow key={`${r.feature}-${r.organization_id ?? "g"}-${i}`}>
                      <TableCell><Badge variant="outline">{FEATURE_LABEL[r.feature] ?? r.feature}</Badge></TableCell>
                      <TableCell className="text-sm">{r.organization_name ?? <span className="text-muted-foreground">unscoped</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.call_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">{r.success_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-600">{r.error_count > 0 ? r.error_count : <span className="text-muted-foreground">0</span>}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.total_prompt_tokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.total_completion_tokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatUsd(r.total_cost_microcents, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.avg_latency_ms ? `${Math.round(r.avg_latency_ms)} ms` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Editable rates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" /> Model rates</CardTitle>
            <CardDescription>USD per 1 million tokens. New rate takes effect within 60 seconds (the edge-function cache TTL).</CardDescription>
          </CardHeader>
          <CardContent>
            {ratesErr && <Alert variant="destructive" className="mb-3"><AlertCircle className="h-4 w-4" /><AlertDescription>{(ratesErr as Error).message}</AlertDescription></Alert>}
            {ratesLoading ? <Skeleton className="h-32 w-full" /> : (
              <RateEditor
                rates={rates ?? []}
                onSave={async (row) => {
                  try {
                    await updateRate.mutateAsync(row);
                    toast.success(`${row.model} rate updated`);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Update failed");
                  }
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* Budget editor (global only for v1) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Monthly budget</CardTitle>
            <CardDescription>The hourly cost-monitor cron compares this-month spend against the budget and fires platform alerts at 80% and 100%.</CardDescription>
          </CardHeader>
          <CardContent>
            {budgetsErr && <Alert variant="destructive" className="mb-3"><AlertCircle className="h-4 w-4" /><AlertDescription>{(budgetsErr as Error).message}</AlertDescription></Alert>}
            {budgetsLoading ? <Skeleton className="h-32 w-full" /> : (
              <BudgetEditor
                budget={globalBudget}
                isSaving={upsertBudget.isPending}
                onSave={async (row) => {
                  try {
                    await upsertBudget.mutateAsync({ ...row, organization_id: null });
                    toast.success("Global budget updated");
                  } catch (e: any) {
                    toast.error(e?.message ?? "Update failed");
                  }
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Recent activity</CardTitle>
            <CardDescription>Last 50 LLM calls across the platform. Newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLoading ? <Skeleton className="h-32 w-full" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Org</TableHead>
                    <TableHead className="text-right">Tokens (in / out)</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recent ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-6">No LLM calls yet.</TableCell></TableRow>
                  ) : (recent ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{FEATURE_LABEL[c.feature] ?? c.feature}</Badge></TableCell>
                      <TableCell className="text-xs font-mono">{c.model}</TableCell>
                      <TableCell className="text-xs">{c.organization_name ?? <span className="text-muted-foreground">unscoped</span>}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{c.prompt_tokens.toLocaleString()} / {c.completion_tokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(c.cost_microcents, 5)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{c.latency_ms ? `${c.latency_ms} ms` : "—"}</TableCell>
                      <TableCell>
                        {c.status === "success"
                          ? <Badge variant="outline" className="border-emerald-500 text-emerald-600">success</Badge>
                          : <Badge variant="destructive" className="text-xs" title={c.error_message ?? undefined}>{c.status}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rate editor row — local edit state per row
// ──────────────────────────────────────────────────────────────────────

function RateEditor({ rates, onSave }: { rates: { model: string; usd_per_million_input: number; usd_per_million_output: number; notes: string | null; updated_at: string }[]; onSave: (row: { model: string; usd_per_million_input: number; usd_per_million_output: number; notes: string | null }) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ input: string; output: string; notes: string }>({ input: "", output: "", notes: "" });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Input ($ / 1M tokens)</TableHead>
          <TableHead className="text-right">Output ($ / 1M tokens)</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead className="text-right">Updated</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rates.map((r) => {
          const isEditing = editing === r.model;
          return (
            <TableRow key={r.model}>
              <TableCell className="font-mono text-sm">{r.model}</TableCell>
              <TableCell className="text-right tabular-nums">
                {isEditing
                  ? <Input className="w-24 text-right inline-block" type="number" step="0.0001" value={draft.input} onChange={(e) => setDraft({ ...draft, input: e.target.value })} />
                  : `$${Number(r.usd_per_million_input).toFixed(4)}`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {isEditing
                  ? <Input className="w-24 text-right inline-block" type="number" step="0.0001" value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value })} />
                  : `$${Number(r.usd_per_million_output).toFixed(4)}`}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {isEditing
                  ? <Input className="w-48" placeholder="optional" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                  : r.notes ?? <span className="text-muted-foreground/50">—</span>}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}</TableCell>
              <TableCell>
                {isEditing ? (
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" onClick={async () => {
                      await onSave({
                        model: r.model,
                        usd_per_million_input:  Number(draft.input),
                        usd_per_million_output: Number(draft.output),
                        notes: draft.notes.trim() || null,
                      });
                      setEditing(null);
                    }}><Save className="h-3.5 w-3.5 mr-1" /> Save</Button>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(r.model); setDraft({ input: String(r.usd_per_million_input), output: String(r.usd_per_million_output), notes: r.notes ?? "" }); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Budget editor — currently global only
// ──────────────────────────────────────────────────────────────────────

function BudgetEditor({ budget, isSaving, onSave }: { budget: AiCostBudget | undefined; isSaving: boolean; onSave: (row: { id?: string; month_budget_cents: number; alert_at_80_pct: boolean; alert_at_100_pct: boolean; notify_email: string | null }) => Promise<void> }) {
  const [draftCents, setDraftCents] = useState<string>(budget ? String(budget.month_budget_cents) : "5000");
  const [alert80,  setAlert80]  = useState<boolean>(budget?.alert_at_80_pct ?? true);
  const [alert100, setAlert100] = useState<boolean>(budget?.alert_at_100_pct ?? true);
  const [email,    setEmail]    = useState<string>(budget?.notify_email ?? "");

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div>
          <Label htmlFor="budget-cents">Monthly budget (cents)</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input id="budget-cents" type="number" step="100" min="0" value={draftCents} onChange={(e) => setDraftCents(e.target.value)} className="w-32" />
            <span className="text-sm text-muted-foreground tabular-nums">= {formatCentsUsd(Number(draftCents) || 0)} USD</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Storing as cents so the column type stays int. $50/month = 5000.</p>
        </div>
        <div>
          <Label htmlFor="notify-email">Notify email (optional)</Label>
          <Input id="notify-email" type="email" placeholder="ops@peritusdigital.com.au" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">If left blank, alerts go via the standard org_alert_recipients pipeline.</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between border rounded p-3">
          <div>
            <Label htmlFor="alert-80">Alert at 80% of budget</Label>
            <p className="text-[11px] text-muted-foreground">Fires once per month. Auto-resets on rollover.</p>
          </div>
          <Switch id="alert-80" checked={alert80} onCheckedChange={setAlert80} />
        </div>
        <div className="flex items-center justify-between border rounded p-3">
          <div>
            <Label htmlFor="alert-100">Alert at 100% of budget</Label>
            <p className="text-[11px] text-muted-foreground">High-severity. Calls continue billing — review and adjust.</p>
          </div>
          <Switch id="alert-100" checked={alert100} onCheckedChange={setAlert100} />
        </div>
        <Button className="w-full" disabled={isSaving} onClick={() => onSave({
          id: budget?.id,
          month_budget_cents: Number(draftCents) || 0,
          alert_at_80_pct:  alert80,
          alert_at_100_pct: alert100,
          notify_email: email.trim() || null,
        })}>
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isSaving ? "Saving…" : "Save budget"}
        </Button>
      </div>
    </div>
  );
}
