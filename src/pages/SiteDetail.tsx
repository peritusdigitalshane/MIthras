import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useSite, useSiteEvents, safeSiteUrl } from "@/hooks/useSites";
import { useSiteFindings, useUpdateFindingStatus, useSiteProtection, useUpdateSiteProtection, useGenerateSiteReport, type FindingSeverity, type ProtectionSettings } from "@/hooks/useSiteAudit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Loader2, ExternalLink, ShieldAlert, FileText, ShieldCheck, ScrollText, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

function severityClass(s: string) {
  switch (s) {
    case "critical": return "bg-red-500/20 text-red-600 border-red-500/40";
    case "error":    return "bg-orange-500/20 text-orange-600 border-orange-500/40";
    case "warning":  return "bg-amber-500/20 text-amber-600 border-amber-500/40";
    default:         return "bg-muted text-muted-foreground border-muted-foreground/30";
  }
}

const SiteDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { isSuperAdmin } = useTenant();
  const { data: site, isLoading: siteLoading } = useSite(id ?? null);
  const { data: events, isLoading: eventsLoading } = useSiteEvents(id ?? null, 300);
  const { data: findings, isLoading: findingsLoading } = useSiteFindings(id ?? null);
  const { data: protection } = useSiteProtection(id ?? null);
  const updateFinding = useUpdateFindingStatus();
  const updateProtection = useUpdateSiteProtection();
  const generateReport = useGenerateSiteReport();
  const [filter, setFilter] = useState("");

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return events;
    return events.filter(e =>
      e.event_type.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      (e.actor_user_login ?? "").toLowerCase().includes(q) ||
      (e.target ?? "").toLowerCase().includes(q) ||
      (e.severity ?? "").toLowerCase().includes(q)
    );
  }, [events, filter]);

  if (siteLoading) {
    return <MainLayout><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!site) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldAlert className="h-12 w-12 text-destructive mb-3" />
          <p>Site not found or you don't have access.</p>
        </div>
      </MainLayout>
    );
  }

  const online = site.last_seen_at ? (Date.now() - new Date(site.last_seen_at).getTime()) < 15 * 60 * 1000 : false;
  const openFindings = (findings ?? []).filter(f => f.status === "open");
  const countsBySeverity = openFindings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleResolve = async (fid: string) => {
    try { await updateFinding.mutateAsync({ id: fid, status: "resolved" }); toast({ title: "Marked resolved" }); }
    catch (e) { toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" }); }
  };
  const handleAccept = async (fid: string) => {
    try { await updateFinding.mutateAsync({ id: fid, status: "accepted_risk" }); toast({ title: "Marked accepted risk" }); }
    catch (e) { toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" }); }
  };
  const handleReopen = async (fid: string) => {
    try { await updateFinding.mutateAsync({ id: fid, status: "open" }); toast({ title: "Reopened" }); }
    catch (e) { toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" }); }
  };

  const toggleProtection = async (key: keyof ProtectionSettings, value: boolean | number) => {
    if (!id) return;
    try {
      await updateProtection.mutateAsync({ siteId: id, settings: { [key]: value } as any });
      toast({ title: "Protection updated", description: "Plugin will apply on next heartbeat (~5 minutes)." });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  const handleReport = async (kind: "weekly" | "monthly" | "ad_hoc") => {
    if (!id) return;
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - (kind === "monthly" ? 30 : 7));
    try {
      const r = await generateReport.mutateAsync({
        siteId: id,
        organizationId: site.organization_id,
        kind,
        periodStart: start.toISOString(),
        periodEnd: now.toISOString(),
      });
      toast({ title: "Report generated", description: r?.ok ? "Find it under Customer Reports." : "Queued." });
    } catch (e) {
      toast({ title: "Report failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" /> {site.name ?? site.site_url}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              {(() => {
                const safe = safeSiteUrl(site.site_url);
                return safe ? (
                  <a href={safe} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline inline-flex items-center gap-1">
                    {site.site_url} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-destructive">{site.site_url} (invalid URL)</span>
                );
              })()}
              · {online
                ? <span className="text-status-healthy">online</span>
                : <span className="text-muted-foreground">last seen {site.last_seen_at ? formatDistanceToNow(new Date(site.last_seen_at), { addSuffix: true }) : "never"}</span>}
            </p>
          </div>
          {isSuperAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleReport("weekly")} disabled={generateReport.isPending}>
                <FileText className="h-3.5 w-3.5 mr-2" /> Weekly report
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleReport("monthly")} disabled={generateReport.isPending}>
                <FileText className="h-3.5 w-3.5 mr-2" /> Monthly report
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">WP / PHP</CardTitle></CardHeader><CardContent className="text-sm font-semibold">{site.wp_version ?? "?"} / {site.php_version ?? "?"}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Plugins</CardTitle></CardHeader><CardContent className="text-lg font-semibold">{site.plugin_count}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Theme</CardTitle></CardHeader><CardContent className="text-sm font-semibold truncate">{site.active_theme ?? "—"}</CardContent></Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Open findings</CardTitle></CardHeader>
            <CardContent className="flex gap-1 items-baseline flex-wrap">
              <span className="text-lg font-semibold">{openFindings.length}</span>
              {countsBySeverity.critical > 0 && <Badge variant="outline" className={severityClass("critical")}>{countsBySeverity.critical} crit</Badge>}
              {countsBySeverity.error > 0 && <Badge variant="outline" className={severityClass("error")}>{countsBySeverity.error} err</Badge>}
              {countsBySeverity.warning > 0 && <Badge variant="outline" className={severityClass("warning")}>{countsBySeverity.warning} warn</Badge>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Events shown</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{events?.length ?? 0}</CardContent>
          </Card>
        </div>

        <Tabs defaultValue="findings">
          <TabsList>
            <TabsTrigger value="findings"><ShieldAlert className="h-3.5 w-3.5 mr-2" /> Findings ({openFindings.length})</TabsTrigger>
            <TabsTrigger value="events"><ScrollText className="h-3.5 w-3.5 mr-2" /> Event log</TabsTrigger>
            <TabsTrigger value="protection"><ShieldCheck className="h-3.5 w-3.5 mr-2" /> Protection</TabsTrigger>
          </TabsList>

          <TabsContent value="findings">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit findings</CardTitle>
                <CardDescription>Daily audit run on the site. Click resolve once an issue is fixed; the plugin will reopen it on the next audit if it's still present.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {findingsLoading ? (
                  <div className="p-6"><Skeleton className="h-40" /></div>
                ) : (findings ?? []).length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground space-y-2">
                    <CheckCircle className="h-10 w-10 mx-auto text-status-healthy opacity-60" />
                    <p>No findings yet. The plugin runs a full audit once a day, or click "Run audit now" in the WP admin → Settings → Mithras SOC.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {findings!.map(f => (
                      <div key={f.id} className="p-4 flex items-start gap-3">
                        <Badge variant="outline" className={`${severityClass(f.severity)} text-[10px] uppercase tracking-wider`}>{f.severity}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium ${f.status !== "open" ? "line-through text-muted-foreground" : ""}`}>{f.title}</div>
                          {f.description && <div className="text-xs text-muted-foreground mt-1">{f.description}</div>}
                          {f.recommendation && <div className="text-xs text-foreground/80 mt-2"><span className="font-medium">→ Next:</span> {f.recommendation}</div>}
                          <div className="text-[11px] text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
                            <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{f.category}</code>
                            <span>first seen {formatDistanceToNow(new Date(f.first_seen_at), { addSuffix: true })}</span>
                            <span>· last seen {formatDistanceToNow(new Date(f.last_seen_at), { addSuffix: true })}</span>
                            <Badge variant={f.status === "open" ? "default" : "secondary"} className="text-[10px]">{f.status}</Badge>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {f.status === "open" ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => handleResolve(f.id)} disabled={updateFinding.isPending}>
                                <CheckCircle className="h-3 w-3 mr-1" /> Resolve
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleAccept(f.id)} disabled={updateFinding.isPending}>
                                Accept risk
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => handleReopen(f.id)} disabled={updateFinding.isPending}>
                              <RefreshCw className="h-3 w-3 mr-1" /> Reopen
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Event stream</CardTitle>
                    <CardDescription>Refreshes every 15s. Showing the most recent 300 events.</CardDescription>
                  </div>
                  <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {eventsLoading ? (
                  <div className="p-6"><Skeleton className="h-40" /></div>
                ) : filteredEvents.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">No events {filter ? "match the filter" : "yet"}.</div>
                ) : (
                  <div className="divide-y">
                    {filteredEvents.map(e => (
                      <div key={e.id} className="flex items-start gap-3 p-3 hover:bg-muted/40 text-sm">
                        <Badge variant="outline" className={`${severityClass(e.severity)} text-[10px] uppercase tracking-wider`}>{e.severity}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{e.summary}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{e.event_type}</code>
                            {e.actor_user_login && <span>by <code>{e.actor_user_login}</code></span>}
                            {e.actor_ip && <span>from <code>{e.actor_ip}</code></span>}
                            {e.target && <span>· {e.target}</span>}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap" title={new Date(e.event_time).toUTCString()}>
                          {formatDistanceToNow(new Date(e.event_time), { addSuffix: true })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="protection">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Protection</CardTitle>
                <CardDescription>Toggles pushed to the WordPress plugin on the next heartbeat (~5 minutes).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!protection ? (
                  <div className="py-6 text-center text-muted-foreground">Loading protection settings…</div>
                ) : (
                  <>
                    {[
                      { key: "disable_file_edit", title: "Disable in-dashboard file editor", desc: "Blocks pasted webshells if an admin is compromised." },
                      { key: "force_ssl_admin", title: "Force HTTPS on /wp-admin", desc: "Redirects admin and login from HTTP." },
                      { key: "disable_xmlrpc", title: "Disable XML-RPC", desc: "Blocks brute-force amplification and pingback DDoS." },
                      { key: "hide_wp_version", title: "Hide WordPress version", desc: "Strip generator meta + asset ?ver query parameters." },
                      { key: "block_user_enumeration", title: "Block user enumeration", desc: "Removes /wp/v2/users REST endpoint + ?author=N redirects." },
                      { key: "security_headers", title: "Add security HTTP headers", desc: "X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS." },
                      { key: "disable_pingbacks", title: "Disable pingbacks", desc: "Stops outbound + inbound pingbacks." },
                      { key: "limit_login_attempts", title: "Lock out repeated login failures", desc: "Block IP after N failures for M minutes." },
                      { key: "require_strong_passwords", title: "Require strong passwords", desc: "Enforce 12+ chars + classes on user create / change." },
                      { key: "disable_app_passwords", title: "Disable application passwords", desc: "Block REST API app-password issuance." },
                      { key: "auto_update_minor_core", title: "Auto-update minor core releases", desc: "Apply minor WP updates automatically." },
                      { key: "auto_update_plugins", title: "Auto-update plugins", desc: "Apply plugin updates automatically." },
                      { key: "auto_update_themes", title: "Auto-update themes", desc: "Apply theme updates automatically." },
                      { key: "scan_uploads_for_php", title: "Scan uploads/ for PHP files", desc: "Detect dropped webshells." },
                    ].map(t => (
                      <div key={t.key} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
                        <div className="flex-1 min-w-0">
                          <Label htmlFor={t.key} className="font-medium">{t.title}</Label>
                          <p className="text-xs text-muted-foreground">{t.desc}</p>
                        </div>
                        <Switch
                          id={t.key}
                          checked={Boolean((protection.settings as any)[t.key])}
                          onCheckedChange={(v) => toggleProtection(t.key as keyof ProtectionSettings, v)}
                          disabled={updateProtection.isPending}
                        />
                      </div>
                    ))}

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                      <div>
                        <Label htmlFor="threshold">Lockout threshold (failures)</Label>
                        <Input id="threshold" type="number" min={2} max={20}
                          value={(protection.settings as any).login_lockout_threshold ?? 5}
                          onChange={(e) => toggleProtection("login_lockout_threshold", parseInt(e.target.value || "5") as any)} />
                      </div>
                      <div>
                        <Label htmlFor="minutes">Lockout duration (minutes)</Label>
                        <Input id="minutes" type="number" min={1} max={1440}
                          value={(protection.settings as any).login_lockout_minutes ?? 30}
                          onChange={(e) => toggleProtection("login_lockout_minutes", parseInt(e.target.value || "30") as any)} />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
};

export default SiteDetail;
