import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { useEmailThreats, useEmailSweepStatus, useEmailAction, useEmailSecurityActivity, type EmailThreat } from "@/hooks/useEmailThreats";
import {
  useEmailBlockRules,
  useCreateEmailBlockRule,
  useUpdateEmailBlockRule,
  useDeleteEmailBlockRule,
  type EmailBlockRule,
  type EmailBlockRuleKind,
  type EmailBlockRuleAction,
} from "@/hooks/useEmailBlockRules";
import { Mail, Shield, AlertTriangle, ChevronDown, ChevronRight, Clock, Trash2, BellRing, Undo2, X, Ban, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SEV_COLOUR: Record<string, string> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const CLS_LABEL: Record<string, string> = {
  phishing: "Phishing",
  bec: "BEC",
  spam: "Spam",
  malware: "Malware",
  suspicious: "Suspicious",
  legitimate: "Legitimate",
};

// Rows already actioned shouldn't be re-bulk-actioned. Quarantine is terminal
// (until the operator chooses to release); released rows are terminal too.
function isActionable(t: EmailThreat, action: "quarantine" | "warn" | "release"): boolean {
  if (action === "quarantine") return t.action_taken !== "quarantined" && t.action_taken !== "released";
  if (action === "warn")       return t.action_taken !== "user_warned" && t.action_taken !== "released";
  if (action === "release")    return t.action_taken !== "released";
  return false;
}

export default function EmailSecurity() {
  const { data: threats, isLoading } = useEmailThreats({ limit: 200 });
  const { data: sweeps } = useEmailSweepStatus();
  const { data: activity } = useEmailSecurityActivity({ days: 30 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const action = useEmailAction();

  const stats = (threats ?? []).reduce(
    (acc, t) => {
      acc.total++;
      if (t.classification === "phishing")        acc.phishing++;
      else if (t.classification === "bec")        acc.bec++;
      else if (t.classification === "malware")    acc.malware++;
      else if (t.classification === "spam")       acc.spam++;
      else if (t.classification === "suspicious") acc.suspicious++;
      return acc;
    },
    { total: 0, phishing: 0, bec: 0, malware: 0, spam: 0, suspicious: 0 }
  );

  const lastSweep = (sweeps ?? []).reduce<string | null>(
    (latest, r) => (!latest || r.last_swept_at > latest ? r.last_swept_at : latest),
    null
  );

  // Campaign sibling counts: for each origin (parent_threat_id NULL with
  // campaign_swept_at set), count how many siblings point back to it. Built
  // from the loaded threats list — only siblings within the current 200-row
  // window get counted, which is fine for the "Campaign — N inboxes" hint.
  const campaignSiblingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of threats ?? []) {
      if (t.parent_threat_id) counts.set(t.parent_threat_id, (counts.get(t.parent_threat_id) ?? 0) + 1);
    }
    return counts;
  }, [threats]);

  const visibleIds = useMemo(() => (threats ?? []).map(t => t.id), [threats]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const anySelected = selected.size > 0;

  const selectedThreats = (threats ?? []).filter(t => selected.has(t.id));
  const counts = {
    quarantine: selectedThreats.filter(t => isActionable(t, "quarantine")).length,
    warn:       selectedThreats.filter(t => isActionable(t, "warn")).length,
    release:    selectedThreats.filter(t => isActionable(t, "release")).length,
  };

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected(prev => {
      if (visibleIds.every(id => prev.has(id))) return new Set();
      return new Set(visibleIds);
    });
  }

  function clearSelection() { setSelected(new Set()); }

  function runBulk(act: "quarantine" | "warn" | "release") {
    const ids = selectedThreats.filter(t => isActionable(t, act)).map(t => t.id);
    if (ids.length === 0) return;
    action.mutate({ threatIds: ids, action: act }, { onSuccess: () => setSelected(new Set()) });
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Email security"
          eyebrowIcon={<Mail className="h-3.5 w-3.5" />}
          title="AI-classified email threats"
          subtitle="Mithras sweeps every connected Microsoft 365 mailbox every two minutes, classifies inbound messages with AI, and surfaces phishing, BEC, malware and suspicious mail here. Quarantine, warn the recipient, or release back to the inbox — one row at a time, or in bulk."
          accent="emerald"
          status={
            lastSweep
              ? { label: `Last sweep ${formatDistanceToNow(new Date(lastSweep), { addSuffix: true })}`, tone: "ok" }
              : { label: "No sweeps yet", tone: "warn" }
          }
        />

        {/* Row 1: activity / "is it working?" confidence numbers */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatTile
            label="Messages scanned (30d)"
            value={activity?.messages_scanned ?? 0}
            tone="default"
            icon={<Shield className="h-4 w-4" />}
            sublabel={activity?.messages_scanned ? `${activity.messages_classified_by_ai.toLocaleString("en-AU")} via AI · ${activity.messages_matched_by_rule.toLocaleString("en-AU")} via block rules` : "Once mail arrives, this counts every message Mithras checks"}
          />
          <StatTile
            label="Mailboxes monitored"
            value={activity?.mailboxes_monitored ?? 0}
            tone="default"
            icon={<Mail className="h-4 w-4" />}
            sublabel={`Peak distinct mailboxes seen in the last 30 days`}
          />
          <StatTile
            label="Threats found (30d)"
            value={activity?.threats_detected ?? 0}
            tone={(activity?.threats_detected ?? 0) > 0 ? "destructive" : "default"}
            icon={<AlertTriangle className="h-4 w-4" />}
            sublabel="Phishing, BEC, malware, spam, suspicious"
          />
        </div>

        {/* Row 2: per-classification breakdown of what's currently in the queue */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label="Total flagged" value={stats.total} tone="default" icon={<Mail className="h-4 w-4" />} />
          <StatTile label="Phishing" value={stats.phishing} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />} />
          <StatTile label="BEC" value={stats.bec} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />} />
          <StatTile label="Malware" value={stats.malware} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />} />
          <StatTile label="Suspicious" value={stats.suspicious} tone="secondary" icon={<Shield className="h-4 w-4" />} />
        </div>

        <Tabs defaultValue="threats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="threats" className="gap-2"><Mail className="h-3.5 w-3.5" /> Flagged messages</TabsTrigger>
            <TabsTrigger value="rules"   className="gap-2"><Ban  className="h-3.5 w-3.5" /> Block rules</TabsTrigger>
          </TabsList>

          <TabsContent value="threats" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <CardTitle className="text-base">Recent flagged messages</CardTitle>
                    <CardDescription>
                      Ordered newest-first. Click a row to see the AI reasoning, suspicious indicators, and recommended action. Tick the checkboxes to action many at once.
                    </CardDescription>
                  </div>
                  {(threats?.length ?? 0) > 0 && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAllVisible}
                        aria-label="Select all visible rows"
                      />
                      Select all visible
                    </label>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
                ) : !threats || threats.length === 0 ? (
                  <PortalEmptyState
                    icon={<Shield className="h-6 w-6 text-muted-foreground" />}
                    title="Nothing flagged yet"
                    description={
                      <p className="text-sm text-muted-foreground">
                        Either no mailboxes are connected, the sweep hasn't run yet, or your fleet's mailboxes are clean for the last five minutes. The next sweep runs at the top of every second minute (UTC).
                      </p>
                    }
                  />
                ) : (
                  <div className="space-y-1">
                    {threats.map(t => (
                      <ThreatRow
                        key={t.id}
                        threat={t}
                        siblingCount={campaignSiblingCounts.get(t.id) ?? 0}
                        selected={selected.has(t.id)}
                        onSelectToggle={() => toggle(t.id)}
                        expanded={expandedId === t.id}
                        onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <BlockRulesPanel />
          </TabsContent>
        </Tabs>
      </div>

      {anySelected && (
        <BulkActionBar
          selectedCount={selected.size}
          counts={counts}
          pending={action.isPending}
          onQuarantine={() => runBulk("quarantine")}
          onWarn={() => runBulk("warn")}
          onRelease={() => runBulk("release")}
          onClear={clearSelection}
        />
      )}
    </MainLayout>
  );
}

function StatTile({ label, value, tone, icon, sublabel }: { label: string; value: number; tone: "default" | "destructive" | "secondary"; icon: React.ReactNode; sublabel?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon} {label}</div>
        <div className={`text-2xl font-bold tabular-nums mt-1 ${tone === "destructive" ? "text-destructive" : ""}`}>
          {value.toLocaleString("en-AU")}
        </div>
        {sublabel && <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

function ThreatRow({ threat, siblingCount, selected, onSelectToggle, expanded, onToggle }: {
  siblingCount: number;
  threat: EmailThreat;
  selected: boolean;
  onSelectToggle: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const iocs = threat.iocs as {
    suspicious_links?: string[];
    suspicious_domains?: string[];
    impersonation_target?: string;
    attachment_names?: string[];
    spoofing_indicators?: string[];
  };
  return (
    <div className={`border rounded-md ${selected ? "border-primary/60 bg-primary/5" : ""}`}>
      <div className="flex items-stretch">
        <div
          className="pl-3 pr-1 flex items-start pt-3.5"
          onClick={(e) => { e.stopPropagation(); onSelectToggle(); }}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={onSelectToggle}
            aria-label={`Select message from ${threat.sender_email ?? "unknown"}`}
          />
        </div>
        <button
          type="button"
          className="flex-1 text-left p-3 hover:bg-muted/50 flex items-start gap-3 min-w-0"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-4 w-4 mt-1 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={SEV_COLOUR[threat.severity] as any}>{CLS_LABEL[threat.classification]}</Badge>
              <Badge variant="outline" className="text-[10px]">{threat.severity}</Badge>
              <Badge variant="outline" className="text-[10px]">{threat.confidence}% conf</Badge>
              {threat.action_taken !== "none" && threat.action_taken !== "flagged" && (
                <Badge variant="secondary" className="text-[10px]">{threat.action_taken}</Badge>
              )}
              {/* Cross-mailbox sweep markers. Origin: count of sibling
                  inboxes that the same Message-ID was also quarantined in.
                  Sibling: indicates this copy was quarantined as part of a
                  campaign sweep, not by a direct operator/AI action. */}
              {threat.campaign_swept_at && threat.parent_threat_id === null && siblingCount > 0 && (
                <Badge variant="default" className="text-[10px]" title="Same Message-ID was quarantined in sibling mailboxes via cross-mailbox sweep.">
                  Campaign — {siblingCount + 1} {siblingCount + 1 === 1 ? "inbox" : "inboxes"}
                </Badge>
              )}
              {threat.parent_threat_id !== null && (
                <Badge variant="outline" className="text-[10px]" title="Quarantined automatically as part of a campaign sweep on a sibling threat.">
                  swept (campaign)
                </Badge>
              )}
              <div className="font-medium truncate">{threat.subject || "(no subject)"}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              From {threat.sender_email ?? "unknown"} → {threat.recipient_email} ·
              <Clock className="inline h-3 w-3 mx-1" />
              {formatDistanceToNow(new Date(threat.received_at), { addSuffix: true })}
            </div>
          </div>
        </button>
      </div>
      {expanded && (
        <div className="border-t p-3 bg-muted/30 space-y-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AI reasoning</div>
            <div className="mt-1">{threat.ai_reasoning ?? "(none recorded)"}</div>
          </div>
          {iocs.suspicious_domains?.length ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Suspicious domains</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {iocs.suspicious_domains.map((d, i) => <Badge key={i} variant="destructive" className="font-mono text-xs">{d}</Badge>)}
              </div>
            </div>
          ) : null}
          {iocs.suspicious_links?.length ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Suspicious links</div>
              <div className="mt-1 space-y-1">
                {iocs.suspicious_links.map((u, i) => <div key={i} className="font-mono text-xs break-all">{u}</div>)}
              </div>
            </div>
          ) : null}
          {iocs.impersonation_target ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Likely impersonating</div>
              <div className="mt-1 font-medium">{iocs.impersonation_target}</div>
            </div>
          ) : null}
          {iocs.attachment_names?.length ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Attachments</div>
              <div className="mt-1 space-y-0.5 font-mono text-xs">
                {iocs.attachment_names.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            </div>
          ) : null}
          <ThreatActions threat={threat} />
        </div>
      )}
    </div>
  );
}

function ThreatActions({ threat }: { threat: EmailThreat }) {
  const action = useEmailAction();
  const createRule = useCreateEmailBlockRule();
  const isReleased    = threat.action_taken === "released";
  const isQuarantined = threat.action_taken === "quarantined";
  const isWarned      = threat.action_taken === "user_warned";

  const senderDomain = threat.sender_domain ?? null;
  const senderEmail  = threat.sender_email ?? null;

  function quickBlock(kind: "sender_domain" | "sender_email") {
    const value = kind === "sender_domain" ? senderDomain : senderEmail;
    if (!value) return;
    createRule.mutate({
      kind, value,
      action: "quarantine",
      reason: `Added from flagged message "${(threat.subject ?? "(no subject)").slice(0, 80)}"`,
    });
  }

  return (
    <div className="border-t pt-3 flex flex-wrap gap-2 items-center">
      <Button
        size="sm"
        variant="destructive"
        disabled={action.isPending || isQuarantined || isReleased}
        onClick={() => action.mutate({ threatId: threat.id, action: "quarantine" })}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        {isQuarantined ? "Quarantined" : "Quarantine"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={action.isPending || isWarned || isReleased}
        onClick={() => action.mutate({ threatId: threat.id, action: "warn" })}
      >
        <BellRing className="h-3.5 w-3.5 mr-1" />
        {isWarned ? "Warning sent" : "Send warning to recipient"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={action.isPending || isReleased}
        onClick={() => action.mutate({ threatId: threat.id, action: "release" })}
      >
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        {isReleased ? "Released" : "Release to Inbox"}
      </Button>
      {senderDomain && (
        <Button
          size="sm"
          variant="ghost"
          disabled={createRule.isPending}
          onClick={() => quickBlock("sender_domain")}
          title={`Auto-quarantine future mail from ${senderDomain}`}
        >
          <Ban className="h-3.5 w-3.5 mr-1" />
          Block domain
        </Button>
      )}
      <div className="ml-auto text-[11px] text-muted-foreground">
        Current state: <span className="font-mono">{threat.action_taken}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Block rules tab
// ----------------------------------------------------------------------------
const KIND_LABEL: Record<EmailBlockRuleKind, string> = {
  sender_email:  "Sender address",
  sender_domain: "Sender domain",
  subject_regex: "Subject regex",
};

const ACTION_LABEL: Record<EmailBlockRuleAction, string> = {
  quarantine: "Quarantine silently",
  warn:       "Quarantine + warn recipient",
  drop:       "Record only (no inbox change)",
};

function BlockRulesPanel() {
  const { data: rules, isLoading } = useEmailBlockRules();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-base">Block rules</CardTitle>
            <CardDescription>
              Rules short-circuit the AI classifier. When a rule matches an inbound message, Mithras applies the rule's action without spending an AI classification. Use this for known-bad senders, impersonation domains, and high-volume spam patterns.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New rule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : !rules || rules.length === 0 ? (
          <PortalEmptyState
            icon={<Ban className="h-6 w-6 text-muted-foreground" />}
            title="No rules yet"
            description={
              <p className="text-sm text-muted-foreground">
                Add a rule to auto-quarantine known-bad senders or pattern-match suspicious subjects. You can also add a rule directly from any flagged message using the "Block domain" button.
              </p>
            }
          />
        ) : (
          <div className="space-y-2">
            {rules.map(r => <RuleRow key={r.id} rule={r} />)}
          </div>
        )}
      </CardContent>
      <NewRuleDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function RuleRow({ rule }: { rule: EmailBlockRule }) {
  const update = useUpdateEmailBlockRule();
  const del = useDeleteEmailBlockRule();
  return (
    <div className={`border rounded-md p-3 flex items-center gap-3 flex-wrap ${rule.enabled ? "" : "opacity-60"}`}>
      <Badge variant="outline" className="font-mono text-[10px]">{KIND_LABEL[rule.kind]}</Badge>
      <div className="font-mono text-sm break-all flex-1 min-w-[200px]">{rule.value}</div>
      <Badge variant="secondary" className="text-[10px]">{ACTION_LABEL[rule.action]}</Badge>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {rule.hit_count} hit{rule.hit_count === 1 ? "" : "s"}
        {rule.last_hit_at ? ` · last ${formatDistanceToNow(new Date(rule.last_hit_at), { addSuffix: true })}` : ""}
      </div>
      <label className="flex items-center gap-2 text-[11px]">
        <Switch
          checked={rule.enabled}
          onCheckedChange={(v) => update.mutate({ id: rule.id, patch: { enabled: !!v } })}
          aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
        />
        {rule.enabled ? "Enabled" : "Disabled"}
      </label>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (confirm(`Delete this ${KIND_LABEL[rule.kind].toLowerCase()} rule for "${rule.value}"?`)) {
            del.mutate(rule.id);
          }
        }}
        disabled={del.isPending}
        aria-label="Delete rule"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function NewRuleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [kind, setKind]     = useState<EmailBlockRuleKind>("sender_domain");
  const [value, setValue]   = useState("");
  const [action, setAction] = useState<EmailBlockRuleAction>("quarantine");
  const [reason, setReason] = useState("");
  const create = useCreateEmailBlockRule();

  function submit() {
    const v = value.trim();
    if (!v) return;
    create.mutate({ kind, value: v, action, reason: reason || null }, {
      onSuccess: () => {
        setValue(""); setReason(""); onOpenChange(false);
      },
    });
  }

  const placeholder = kind === "sender_email" ? "user@evilcorp.com"
                    : kind === "sender_domain" ? "evilcorp.com"
                    : "^(URGENT|Wire transfer)";
  const helper = kind === "sender_domain"
    ? "Matches the domain exactly and any subdomain. Lowercase, no scheme."
    : kind === "sender_email"
    ? "Exact-match on the From address. Case-insensitive."
    : "JavaScript regex tested against the subject line, case-insensitive.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add block rule</DialogTitle>
          <DialogDescription>
            Rules apply only to your organisation. Mithras checks them before running the AI classifier; matches save tokens and behave predictably.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-kind">Match on</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as EmailBlockRuleKind)}>
              <SelectTrigger id="rule-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sender_domain">Sender domain</SelectItem>
                <SelectItem value="sender_email">Sender address</SelectItem>
                <SelectItem value="subject_regex">Subject regex</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-value">Value</Label>
            <Input id="rule-value" value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} />
            <p className="text-[11px] text-muted-foreground">{helper}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-action">Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as EmailBlockRuleAction)}>
              <SelectTrigger id="rule-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="quarantine">Quarantine silently — move to Junk Email</SelectItem>
                <SelectItem value="warn">Quarantine + warn recipient — move to Junk and email them a release link</SelectItem>
                <SelectItem value="drop">Record only — no inbox change, just appears on the dashboard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-reason">Reason (optional)</Label>
            <Input id="rule-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Known phishing campaign Q2 2026" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || !value.trim()}>
            {create.isPending ? "Adding…" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkActionBar({
  selectedCount, counts, pending, onQuarantine, onWarn, onRelease, onClear,
}: {
  selectedCount: number;
  counts: { quarantine: number; warn: number; release: number };
  pending: boolean;
  onQuarantine: () => void;
  onWarn: () => void;
  onRelease: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-40 mx-auto max-w-6xl px-6">
      <div className="rounded-lg border bg-background shadow-lg p-3 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-medium">
          {selectedCount} selected
        </div>
        <div className="h-5 w-px bg-border" />
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || counts.quarantine === 0}
          onClick={onQuarantine}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Quarantine ({counts.quarantine})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || counts.warn === 0}
          onClick={onWarn}
        >
          <BellRing className="h-3.5 w-3.5 mr-1.5" />
          Send warning ({counts.warn})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || counts.release === 0}
          onClick={onRelease}
        >
          <Undo2 className="h-3.5 w-3.5 mr-1.5" />
          Release ({counts.release})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onClear}
          disabled={pending}
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}
