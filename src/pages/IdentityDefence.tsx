import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck, AlertTriangle, Pause, CheckCircle2, EyeOff, Eye, Trash2,
  Sparkles, Bot, Mail, ChevronDown, ChevronRight, Info,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  useIdentityOverview, useIdentityRules, useIdentityActions,
  useCreateRuleFromTemplate, useUpdateRuleMode, useDeleteRule, usePauseAllEnforcement,
  TRIGGER_KIND_LABEL, ACTION_KIND_LABEL, RULE_TEMPLATES,
  type IdentityRule, type IdentityAction, type RuleMode,
} from "@/hooks/useIdentityDefence";

// Mithras Identity Defence — Phase A
//
// Detect-and-respond loop. NOT a preventive identity control. We're honest
// about that on every rule card. Operator picks templates, watches dry-run
// output in report-only mode, then flips to enforce when comfortable.

const MODE_LABEL: Record<RuleMode, string> = {
  off:         "Disabled",
  report_only: "Report-only",
  enforce:     "Enforced",
};

const MODE_TONE: Record<RuleMode, string> = {
  off:         "border-muted-foreground/40 text-muted-foreground",
  report_only: "border-amber-500/40 text-amber-500",
  enforce:     "border-emerald-500/40 text-emerald-500",
};

const OUTCOME_TONE: Record<string, string> = {
  enforced:             "text-emerald-500",
  would_have_fired:     "text-amber-500",
  failed:               "text-status-critical",
  skipped_break_glass:  "text-muted-foreground",
  skipped_rate_limit:   "text-muted-foreground",
  skipped_cooldown:     "text-muted-foreground",
  skipped_org_cap:      "text-status-critical",
  skipped_applies_to:   "text-muted-foreground",
};

const OUTCOME_LABEL: Record<string, string> = {
  enforced:             "Enforced",
  would_have_fired:     "Would have fired (dry-run)",
  failed:               "Failed",
  skipped_break_glass:  "Skipped — break-glass user",
  skipped_rate_limit:   "Skipped — per-user rate limit",
  skipped_cooldown:     "Skipped — first-24h cooldown",
  skipped_org_cap:      "Skipped — org cap reached",
  skipped_applies_to:   "Skipped — not in scope",
};

const TRIGGER_ICON: Record<string, React.ReactNode> = {
  endpoint_defender_critical: <Bot className="h-4 w-4" />,
  mailbox_rule_added:         <Mail className="h-4 w-4" />,
};

export default function IdentityDefencePage() {
  const overview = useIdentityOverview();
  const rules    = useIdentityRules();
  const actions  = useIdentityActions({ limit: 100 });
  const create   = useCreateRuleFromTemplate();
  const updateMode = useUpdateRuleMode();
  const deleteRule = useDeleteRule();
  const pauseAll = usePauseAllEnforcement();
  const [showTemplates, setShowTemplates] = useState(false);
  const [confirmPause, setConfirmPause]   = useState(false);
  const [confirmPromote, setConfirmPromote] = useState<IdentityRule | null>(null);

  const o = overview.data;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Identity Defence
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Declarative access rules over the signals Mithras already collects —
              endpoint posture, mailbox activity, M365 identity events.
              Detect-and-respond loop, not a preventive identity gate. We disclose
              the tradeoff on every rule.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowTemplates(true)} size="sm" variant="outline">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Add rule
            </Button>
            {(o?.rules_enforced ?? 0) > 0 && (
              <Button onClick={() => setConfirmPause(true)} size="sm" variant="outline" className="border-status-critical/40 text-status-critical hover:bg-status-critical/10">
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                Pause all enforcement
              </Button>
            )}
          </div>
        </div>

        {/* Tradeoff disclosure strip */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-3">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <span className="font-medium">Honest disclosure:</span> Mithras Identity Defence enforces
              by detecting a signal and reacting (revoke sessions, isolate endpoint, alert). Microsoft
              Conditional Access enforces at the sign-in itself. There is a short window between
              compromise and our reaction. For most SMB threat models that gap is acceptable —
              for the ones it isn't, talk to your reseller about adding Entra ID P1 on top.
            </div>
          </CardContent>
        </Card>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Rules" value={o?.rules_total ?? "—"} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
          <Kpi label="Enforced" value={o?.rules_enforced ?? "—"} icon={<CheckCircle2 className="h-3.5 w-3.5" />} accent={(o?.rules_enforced ?? 0) > 0 ? "ok" : undefined} />
          <Kpi label="Report-only" value={o?.rules_report_only ?? "—"} icon={<Eye className="h-3.5 w-3.5" />} accent={(o?.rules_report_only ?? 0) > 0 ? "warn" : undefined} />
          <Kpi
            label="Actions (24h)"
            value={o?.actions_last_24h ?? "—"}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            sub={o ? `${o.actions_enforced_24h} enforced · ${o.actions_report_only_24h} dry-run` : undefined}
          />
        </div>

        {/* Rules */}
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Active rules</h2>
          {rules.isLoading ? (
            <Card><CardContent className="p-4"><Skeleton className="h-24" /></CardContent></Card>
          ) : (rules.data ?? []).length === 0 ? (
            <Card><CardContent className="p-6 text-center">
              <ShieldCheck className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
              <div className="font-medium text-sm">No rules yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                Pick a starting template to add your first detect-and-respond rule.
                Every rule ships in report-only mode by default.
              </div>
              <Button size="sm" className="mt-3" onClick={() => setShowTemplates(true)}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Pick a template
              </Button>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(rules.data ?? []).map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  onSetMode={(mode) => {
                    if (mode === "enforce") setConfirmPromote(r);
                    else updateMode.mutate({ ruleId: r.id, mode });
                  }}
                  onDelete={() => {
                    if (confirm(`Delete rule "${r.name}"? Past actions are kept; future evaluations stop.`)) {
                      deleteRule.mutate(r.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Actions ledger */}
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Recent actions</h2>
          {actions.isLoading ? (
            <Card><CardContent className="p-4"><Skeleton className="h-32" /></CardContent></Card>
          ) : (actions.data ?? []).length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              No rule has fired yet. Once a rule matches a signal, every match — enforced or dry-run —
              appears here with the evidence that triggered it.
            </CardContent></Card>
          ) : (
            <div className="space-y-1">
              {(actions.data ?? []).map((a) => <ActionRow key={a.id} action={a} rules={rules.data ?? []} />)}
            </div>
          )}
        </section>
      </div>

      {/* Template picker */}
      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pick a rule template</DialogTitle>
            <DialogDescription>
              Each template ships in report-only mode. Watch the dry-run output for 24 hours,
              then promote to enforce when you're comfortable.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {RULE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                onClick={async () => {
                  await create.mutateAsync(tpl.key);
                  setShowTemplates(false);
                }}
                disabled={create.isPending}
                className="w-full text-left rounded-lg border border-border/40 p-3 hover:border-primary/40 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-primary">{TRIGGER_ICON[tpl.trigger_kind]}</span>
                  <span className="font-medium text-sm">{tpl.name}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tpl.actions.map((a, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {ACTION_KIND_LABEL[a.kind] ?? a.kind}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pause-all confirm */}
      <Dialog open={confirmPause} onOpenChange={setConfirmPause}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause all enforcement?</DialogTitle>
            <DialogDescription>
              Every enforce-mode rule will move to report-only. Future signals still get logged so you
              can see what would have happened, but no sessions get revoked and no endpoints get isolated.
              You can promote rules back individually when you're ready.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPause(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { pauseAll.mutate(); setConfirmPause(false); }}
              disabled={pauseAll.isPending}
            >
              Pause everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promote-to-enforce confirm */}
      <Dialog open={!!confirmPromote} onOpenChange={(open) => !open && setConfirmPromote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote rule to enforce?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{confirmPromote?.name}</span> will start taking real action on the next matching signal.
              For the first 24 hours the rule is capped at 5 enforced actions total and 1 per user per day — this gives you
              room to catch any unexpected behaviour before it scales.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPromote(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (confirmPromote) updateMode.mutate({ ruleId: confirmPromote.id, mode: "enforce" });
                setConfirmPromote(null);
              }}
              disabled={updateMode.isPending}
            >
              Yes — start enforcing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

function Kpi({ label, value, icon, sub, accent }: {
  label: string; value: number | string; icon: React.ReactNode; sub?: string;
  accent?: "ok" | "warn" | "danger";
}) {
  const c =
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
        <div className={`text-2xl font-bold tabular-nums ${c}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function RuleCard({ rule, onSetMode, onDelete }: {
  rule: IdentityRule;
  onSetMode: (mode: RuleMode) => void;
  onDelete: () => void;
}) {
  const tone = MODE_TONE[rule.mode];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-muted-foreground">{TRIGGER_ICON[rule.trigger_kind]}</span>
              <span className="font-medium text-sm">{rule.name}</span>
              <Badge variant="outline" className={`text-[10px] ${tone}`}>{MODE_LABEL[rule.mode]}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-2 leading-relaxed">
              {TRIGGER_KIND_LABEL[rule.trigger_kind] ?? rule.trigger_kind}
              {rule.description && <span> — {rule.description}</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {rule.actions.map((a, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {ACTION_KIND_LABEL[a.kind] ?? a.kind}
                </Badge>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Rate limit: {rule.rate_limit_per_user_per_day}/user/day ·
              Break-glass: {rule.break_glass_users.length === 0 ? "none" : `${rule.break_glass_users.length} excluded`} ·
              Last evaluated: {rule.last_evaluated_at ? formatDistanceToNow(new Date(rule.last_evaluated_at), { addSuffix: true }) : "never"}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {rule.mode === "report_only" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSetMode("enforce")}>
                Promote to enforce
              </Button>
            )}
            {rule.mode === "enforce" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSetMode("report_only")}>
                <EyeOff className="h-3 w-3 mr-1" /> Back to report-only
              </Button>
            )}
            {rule.mode !== "off" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onSetMode("off")}>
                Disable
              </Button>
            )}
            {rule.mode === "off" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSetMode("report_only")}>
                Re-enable as report-only
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs text-status-critical" onClick={onDelete}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionRow({ action, rules }: { action: IdentityAction; rules: IdentityRule[] }) {
  const [open, setOpen] = useState(false);
  const tone = OUTCOME_TONE[action.outcome] ?? "text-muted-foreground";
  const label = OUTCOME_LABEL[action.outcome] ?? action.outcome;
  const rule = rules.find((r) => r.id === action.rule_id);
  return (
    <Card>
      <CardContent className="p-2.5">
        <button onClick={() => setOpen(!open)} className="w-full text-left">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              <span className={`font-medium ${tone}`}>{label}</span>
              <span className="text-muted-foreground truncate">{action.target_user}</span>
              {rule && <Badge variant="outline" className="text-[10px]">{rule.name}</Badge>}
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(action.created_at), { addSuffix: true })}
            </span>
          </div>
        </button>
        {open && (
          <div className="mt-2 pt-2 border-t border-border/40 space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Evidence</div>
              <pre className="text-[10px] leading-tight font-mono bg-muted/30 rounded p-2 overflow-x-auto">
                {JSON.stringify(action.evidence, null, 2)}
              </pre>
            </div>
            {Array.isArray(action.actions_taken) && action.actions_taken.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Actions taken</div>
                <pre className="text-[10px] leading-tight font-mono bg-muted/30 rounded p-2 overflow-x-auto">
                  {JSON.stringify(action.actions_taken, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
