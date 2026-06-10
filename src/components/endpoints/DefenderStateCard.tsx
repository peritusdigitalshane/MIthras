import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, ShieldOff, KeyRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface DefenderState {
  collected_at: string;
  active_threats: Array<{
    threat_id: string;
    threat_name: string;
    severity_id: number;
    category_id: number;
    resources: string[];
    detection_time: string | null;
  }>;
  active_threat_count: number;
  recent_detections_24h: Array<{
    threat_id: string;
    detected_at: string;
    action_success: boolean;
    resource_short: string | null;
  }>;
  recent_detection_count: number;
  behavior_monitoring: "on" | "off" | "unknown";
  realtime_protection: "on" | "off" | "unknown";
  tamper_protection: "on" | "off" | "unknown";
  mithras_paths_excluded: boolean;
  asr_rules: Array<{ rule_id: string; rule_name: string; mode: string }>;
  last_quick_scan_at: string | null;
  last_full_scan_at: string | null;
}

// PowerShell's ConvertTo-Json double-wraps single-element arrays (asr_rules,
// active_threats, recent_detections_24h all arrive as [[...]]). Flatten one
// level defensively so the renderer sees the real items.
function flat<T>(maybeNested: unknown): T[] {
  if (!Array.isArray(maybeNested)) return [];
  const out: T[] = [];
  for (const x of maybeNested) {
    if (Array.isArray(x)) out.push(...(x as T[]));
    else out.push(x as T);
  }
  return out;
}

// new Date(undefined / "") gives Invalid Date; date-fns throws RangeError on
// it. Guard so a missing timestamp doesn't blank out the whole page.
function safeDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function statusPill(label: string, state: "on" | "off" | "unknown") {
  const color =
    state === "on"
      ? "bg-status-healthy/10 text-status-healthy border-status-healthy/40"
      : state === "off"
        ? "bg-destructive/10 text-destructive border-destructive/40"
        : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`${color} gap-1`}>
      {state === "on" ? <ShieldCheck className="h-3 w-3" /> : state === "off" ? <ShieldOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
      <span>{label}: {state}</span>
    </Badge>
  );
}

export function DefenderStateCard({ endpointId }: { endpointId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["endpoint-defender-state", endpointId],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("endpoints")
        .select("defender_state, defender_state_updated_at")
        .eq("id", endpointId)
        .maybeSingle();
      if (error) throw error;
      return row as { defender_state: DefenderState | null; defender_state_updated_at: string | null } | null;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Defender state</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  const ds = data?.defender_state ?? null;
  if (!ds) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Defender state</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No snapshot yet — endpoint needs to run agent v0.6.6+ and report a heartbeat.
        </CardContent>
      </Card>
    );
  }

  const asrRules        = flat<{ rule_id: string; rule_name: string; mode: string }>(ds.asr_rules);
  const activeThreats   = flat<DefenderState["active_threats"][number]>(ds.active_threats);
  const recentDetections = flat<DefenderState["recent_detections_24h"][number]>(ds.recent_detections_24h);
  const stateUpdatedAt  = safeDate(data?.defender_state_updated_at ?? null);

  const asrBlock = asrRules.filter(r => r.mode === "Block").length;
  const asrAudit = asrRules.filter(r => r.mode === "Audit").length;
  const asrDisabled = asrRules.filter(r => r.mode === "Disabled").length;
  const inLockdownRisk = ds.active_threat_count > 0 && !ds.mithras_paths_excluded;

  return (
    <Card className={inLockdownRisk ? "border-destructive/40" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {inLockdownRisk ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <Shield className="h-4 w-4" />}
          Defender state
          {stateUpdatedAt && (
            <span className="text-xs font-normal text-muted-foreground">
              · updated {formatDistanceToNow(stateUpdatedAt, { addSuffix: true })}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {inLockdownRisk && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> Possible lockdown
            </div>
            <p className="mt-1 text-muted-foreground">
              {ds.active_threat_count} active Defender threat{ds.active_threat_count > 1 ? "s" : ""} and the Mithras agent paths
              are not in Defender's exclusion list. If the operator on the box can't run PowerShell, use
              Emergency unlock in the response card above.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {statusPill("Real-time", ds.realtime_protection)}
          {statusPill("Behavior monitor", ds.behavior_monitoring)}
          {statusPill("Tamper protection", ds.tamper_protection)}
          <Badge variant="outline" className={`gap-1 ${ds.mithras_paths_excluded ? "bg-status-healthy/10 text-status-healthy border-status-healthy/40" : "bg-yellow-500/10 text-yellow-600 border-yellow-500/40"}`}>
            <KeyRound className="h-3 w-3" />
            <span>Agent excluded: {ds.mithras_paths_excluded ? "yes" : "no"}</span>
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="font-medium text-muted-foreground mb-1">Active threats ({ds.active_threat_count})</div>
            {ds.active_threat_count === 0 ? (
              <p className="text-muted-foreground">None — Defender is clean.</p>
            ) : (
              <ul className="space-y-1">
                {activeThreats.slice(0, 5).map((t, i) => {
                  const detected = safeDate(t.detection_time);
                  return (
                    <li key={`${t.threat_id ?? "t"}-${i}`} className="border rounded p-2">
                      <div className="font-mono text-xs">{t.threat_name}</div>
                      <div className="text-xs text-muted-foreground">
                        severity {t.severity_id} · {detected ? formatDistanceToNow(detected, { addSuffix: true }) : "unknown time"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <div className="font-medium text-muted-foreground mb-1">Last 24h ({ds.recent_detection_count})</div>
            {ds.recent_detection_count === 0 ? (
              <p className="text-muted-foreground">No detections.</p>
            ) : (
              <ul className="space-y-1">
                {recentDetections.slice(0, 5).map((d, i) => {
                  const detected = safeDate(d.detected_at);
                  return (
                    <li key={`${d.threat_id ?? "d"}-${i}`} className="border rounded p-2">
                      <div className="text-xs">
                        threat {d.threat_id} · {d.action_success ? "remediated" : "PENDING"}
                      </div>
                      {d.resource_short && (
                        <div className="text-xs text-muted-foreground font-mono truncate" title={d.resource_short}>
                          {d.resource_short}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {detected ? formatDistanceToNow(detected, { addSuffix: true }) : "unknown time"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {asrRules.length > 0 && (
          <div className="text-sm">
            <div className="font-medium text-muted-foreground mb-1">ASR rules</div>
            <div className="flex gap-3 text-xs">
              <span className="text-destructive">Block: {asrBlock}</span>
              <span className="text-yellow-600">Audit: {asrAudit}</span>
              <span className="text-muted-foreground">Disabled: {asrDisabled}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
