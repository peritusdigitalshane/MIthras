import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PortalHero } from "@/components/portal/PortalHero";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import {
  useSiemDestinations, useSiemOutboxRecent, useUpsertSiemDestination,
  useDeleteSiemDestination, useSendTestEvent,
  type SiemDestination, type SiemDestinationInput, type SiemKind, type SiemFormat,
} from "@/hooks/useSiemDestinations";
import {
  Activity, Plus, Pencil, Trash2, Cable, Send, AlertTriangle, CheckCircle2, Clock,
  ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ALL_CATEGORIES = [
  { key: "threat",   label: "Threats (Defender detections)" },
  { key: "alert",    label: "Alerts (Mithras SOC)" },
  { key: "incident", label: "Incidents (correlated cases)" },
  { key: "firewall", label: "Firewall traffic (high volume)" },
];

const KIND_LABELS: Record<SiemKind, { label: string; needsExtra: string[] }> = {
  webhook:      { label: "Generic webhook",   needsExtra: [] },
  syslog_https: { label: "Syslog over HTTPS", needsExtra: [] },
  splunk_hec:   { label: "Splunk HEC",        needsExtra: [] },
  sentinel_la:  { label: "Microsoft Sentinel (Log Analytics)", needsExtra: ["workspace_id", "log_type"] },
  elastic_http: { label: "Elasticsearch HTTP", needsExtra: ["bulk"] },
};

const EMPTY: SiemDestinationInput = {
  name: "",
  kind: "webhook",
  format: "json",
  endpoint_url: "",
  auth_token: "",
  extra: {},
  event_categories: ["threat", "alert", "incident"],
  enabled: true,
};

export default function SiemIntegrations() {
  const { data: destinations, isLoading } = useSiemDestinations();
  const upsert = useUpsertSiemDestination();
  const del    = useDeleteSiemDestination();
  const test   = useSendTestEvent();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SiemDestinationInput>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<SiemDestination | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const openCreate = () => {
    setEditorId(null);
    setDraft(EMPTY);
    setEditorOpen(true);
  };

  const openEdit = (d: SiemDestination) => {
    setEditorId(d.id);
    setDraft({
      name: d.name,
      kind: d.kind,
      format: d.format,
      endpoint_url: d.endpoint_url,
      auth_token: d.auth_token ?? "",
      extra: d.extra ?? {},
      event_categories: d.event_categories ?? [],
      enabled: d.enabled,
    });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.endpoint_url.trim()) return;
    try {
      await upsert.mutateAsync({ id: editorId ?? undefined, values: draft });
      setEditorOpen(false);
    } catch { /* toasted */ }
  };

  const toggleCategory = (k: string) => {
    setDraft(d => ({
      ...d,
      event_categories: d.event_categories.includes(k)
        ? d.event_categories.filter(c => c !== k)
        : [...d.event_categories, k],
    }));
  };

  const needsExtra = useMemo(() => KIND_LABELS[draft.kind].needsExtra, [draft.kind]);

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <PortalHero
          eyebrow="Integrations"
          eyebrowIcon={<Cable className="h-3.5 w-3.5" />}
          title="SIEM forwarding"
          subtitle="Stream every threat, alert and incident into your customer's existing SIEM. Splunk, Sentinel, Elastic, or any HTTPS endpoint that speaks CEF, LEEF or JSON."
          accent="indigo"
          actions={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> New destination
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cable className="h-4 w-4 text-primary" /> Destinations
            </CardTitle>
            <CardDescription>
              Each destination is delivered on a 60-second cron tick. Failed deliveries retry with exponential backoff (30s → 1h) for 8 attempts before being marked permanent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            ) : (destinations ?? []).length === 0 ? (
              <PortalEmptyState
                icon={<Cable className="h-6 w-6 text-muted-foreground" />}
                title="No SIEM destinations yet"
                description={
                  <p className="text-sm text-muted-foreground">
                    Pick where your security events should flow — Splunk HEC, Sentinel Log Analytics, an Elastic cluster, or any HTTPS endpoint that speaks JSON / CEF / LEEF.
                  </p>
                }
                primaryAction={{ label: "Add your first destination", onClick: openCreate }}
              />
            ) : (
              <div className="space-y-2">
                {(destinations ?? []).map(d => {
                  const isExpanded = expandedId === d.id;
                  return (
                    <Card key={d.id} className={!d.enabled ? "opacity-60" : undefined}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate flex items-center gap-2">
                              {d.name}
                              <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[d.kind].label}</Badge>
                              <Badge variant="outline" className="text-[10px] uppercase">{d.format}</Badge>
                              {!d.enabled && <Badge variant="destructive" className="text-[10px]">Disabled</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono truncate">{d.endpoint_url}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-3 mt-1">
                              <span>Forwards: {(d.event_categories ?? []).join(", ") || "—"}</span>
                              {d.last_success_at && (
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
                                  <CheckCircle2 className="h-3 w-3" /> last ok {formatDistanceToNow(new Date(d.last_success_at), { addSuffix: true })}
                                </span>
                              )}
                              {d.last_failure_at && (
                                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                                  <AlertTriangle className="h-3 w-3" /> last fail {formatDistanceToNow(new Date(d.last_failure_at), { addSuffix: true })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => test.mutate(d.id)} disabled={test.isPending}>
                              <Send className="h-3.5 w-3.5 mr-1" /> Test
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                              {isExpanded ? "Hide" : "Recent"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(d)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {d.last_failure_reason && d.last_failure_at && !d.last_success_at && (
                          <div className="text-xs text-amber-600 dark:text-amber-500 border-l-2 border-amber-500/60 pl-2">
                            Last error: {d.last_failure_reason}
                          </div>
                        )}
                        {isExpanded && <RecentEventsList destId={d.id} />}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Generic event ingest</CardTitle>
            <CardDescription>
              Send events INTO Mithras from non-agent sources (firewalls, routers, Linux hosts, custom apps) using the public REST endpoint and a customer API key with <span className="font-mono">events:write</span> scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div className="font-mono bg-muted/50 p-3 rounded text-[11px] whitespace-pre-wrap">
{`POST https://api.mithras.com.au/functions/v1/event-ingest
Authorization: Bearer mit_live_<token>
Content-Type: application/json

{
  "events": [
    {
      "source_kind": "firewall",
      "source_label": "FortiGate-HQ",
      "severity": "high",
      "vendor": "Fortinet",
      "event_name": "intrusion_blocked",
      "raw_message": "<117>1 2026-06-14T07:00:00Z fg-hq fortios ...",
      "parsed": { "srcip": "203.0.113.5", "dstport": 22 }
    }
  ]
}`}
            </div>
            <p className="text-muted-foreground">
              CEF and LEEF can be POSTed as <span className="font-mono">text/plain</span> (one line per event). Syslog appliances can wrap RFC 5424 messages in <span className="font-mono">{"{messages: [...]}"}</span>. Issue API keys at <a className="underline" href="/api-keys">/api-keys</a>.
            </p>
          </CardContent>
        </Card>

        {/* ──────── Editor ──────── */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editorId ? "Edit destination" : "New SIEM destination"}</DialogTitle>
              <DialogDescription>
                Mithras will format each event to the chosen wire format and POST it to your endpoint. Auth token is treated as a Bearer / Splunk-token / Sentinel-key depending on the destination type.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Acme Splunk Cloud" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Kind</Label>
                  <Select value={draft.kind} onValueChange={(v: SiemKind) => setDraft({ ...draft, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(KIND_LABELS).map(([k, info]) => (
                        <SelectItem key={k} value={k}>{info.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Format</Label>
                  <Select value={draft.format} onValueChange={(v: SiemFormat) => setDraft({ ...draft, format: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="cef">CEF (ArcSight-style)</SelectItem>
                      <SelectItem value="leef">LEEF (QRadar-style)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Endpoint URL</Label>
                <Input value={draft.endpoint_url}
                  onChange={e => setDraft({ ...draft, endpoint_url: e.target.value })}
                  placeholder="https://splunk.example.com:8088/services/collector/event" />
              </div>
              <div>
                <Label className="text-xs">Auth token / key</Label>
                <Input value={draft.auth_token ?? ""} type="password"
                  onChange={e => setDraft({ ...draft, auth_token: e.target.value })}
                  placeholder="HEC token, Bearer secret, Sentinel workspace key, Elastic API key…" />
                <p className="text-[11px] text-muted-foreground mt-1">Stored server-side; only org admins of this tenant can read it back.</p>
              </div>

              {needsExtra.includes("workspace_id") && (
                <div>
                  <Label className="text-xs">Sentinel workspace ID</Label>
                  <Input value={String(draft.extra?.workspace_id ?? "")}
                    onChange={e => setDraft({ ...draft, extra: { ...(draft.extra ?? {}), workspace_id: e.target.value } })}
                    placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
              )}
              {needsExtra.includes("log_type") && (
                <div>
                  <Label className="text-xs">Sentinel custom-log table name</Label>
                  <Input value={String(draft.extra?.log_type ?? "MithrasEvents")}
                    onChange={e => setDraft({ ...draft, extra: { ...(draft.extra ?? {}), log_type: e.target.value } })}
                    placeholder="MithrasEvents" />
                  <p className="text-[11px] text-muted-foreground mt-1">No underscores. Sentinel will append "_CL" automatically.</p>
                </div>
              )}
              {needsExtra.includes("bulk") && (
                <label className="flex items-center gap-2 text-sm pt-1">
                  <Checkbox checked={!!draft.extra?.bulk}
                    onCheckedChange={(v) => setDraft({ ...draft, extra: { ...(draft.extra ?? {}), bulk: !!v } })} />
                  Use Elasticsearch <span className="font-mono">_bulk</span> endpoint (recommended for high-volume clusters)
                </label>
              )}

              <div className="space-y-1.5 pt-1">
                <Label className="text-xs">Forward which events?</Label>
                {ALL_CATEGORIES.map(c => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={draft.event_categories.includes(c.key)}
                      onCheckedChange={() => toggleCategory(c.key)} />
                    {c.label}
                    {c.key === "firewall" && (
                      <Badge variant="outline" className="text-[10px]">Noisy</Badge>
                    )}
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between border-t pt-2">
                <Label className="text-sm">Enabled</Label>
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={!draft.name.trim() || !draft.endpoint_url.trim() || upsert.isPending}>
                {upsert.isPending ? "Saving…" : (editorId ? "Save changes" : "Create destination")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ──────── Delete ──────── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this destination?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>. Any events still queued for it will be dropped. Existing events already delivered are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (deleteTarget) await del.mutateAsync(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete destination
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}

function RecentEventsList({ destId }: { destId: string }) {
  const { data, isLoading } = useSiemOutboxRecent(destId);
  if (isLoading) return <div className="text-xs text-muted-foreground pt-2">Loading…</div>;
  if (!data || data.length === 0) {
    return <div className="text-xs text-muted-foreground pt-2">No recent events.</div>;
  }
  return (
    <div className="space-y-1 pt-2 border-t">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Last 50 events</div>
      <div className="text-xs space-y-1 max-h-72 overflow-y-auto font-mono">
        {data.map(e => (
          <div key={e.id} className="flex items-center gap-2 py-0.5">
            <span className={
              e.status === "sent"             ? "text-emerald-600" :
              e.status === "failed_permanent" ? "text-destructive" :
                                                "text-amber-600"
            }>
              {e.status === "sent" ? "✓" : e.status === "failed_permanent" ? "✗" : "…"}
            </span>
            <span className="text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
            <span>{e.category}</span>
            <span className="text-muted-foreground truncate">{e.source_table}</span>
            {e.attempts > 0 && <Badge variant="outline" className="text-[10px]">×{e.attempts}</Badge>}
            {e.last_error && <span className="text-amber-600 truncate" title={e.last_error}>{e.last_error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
