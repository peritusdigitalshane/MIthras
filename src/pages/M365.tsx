import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Cloud, RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle, Mail, Key, UserCheck, Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
    useM365Tenants,
    useM365Alerts,
    useM365SignIns,
    useM365ForwardingRules,
    useM365HighRiskOAuthGrants,
    useStartM365Connect,
    useM365AzureConfigured,
    usePollM365Tenant,
    useDisconnectM365Tenant,
    useDeleteM365Tenant,
    type M365Tenant,
} from "@/hooks/useM365";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parsePollError } from "@/lib/m365-error";

export default function M365() {
    const { toast } = useToast();
    const { isSuperAdmin } = useTenant();
    const [searchParams, setSearchParams] = useSearchParams();
    const tenants = useM365Tenants();
    const alerts = useM365Alerts();
    const signIns = useM365SignIns({ riskyOnly: true, limit: 25 });
    const fwdRules = useM365ForwardingRules();
    const oauthGrants = useM365HighRiskOAuthGrants();
    const startConnect = useStartM365Connect();
    const azureConfig = useM365AzureConfigured();
    const azureMissing = azureConfig.data && !azureConfig.data.configured;

    // Surface the OAuth callback result that the redirect carries.
    useEffect(() => {
        const connected = searchParams.get("connected");
        const err = searchParams.get("m365_error");
        const errDesc = searchParams.get("m365_error_description");
        if (connected) {
            toast({
                title: "Microsoft 365 connected",
                description: "First poll runs within 5 minutes. Use 'Poll now' to ingest immediately.",
            });
            setSearchParams({}, { replace: true });
        } else if (err) {
            toast({
                title: "Could not connect Microsoft 365",
                description: `${err}${errDesc ? `: ${errDesc}` : ""}`,
                variant: "destructive",
            });
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams, toast]);

    const activeTenants = (tenants.data ?? []).filter((t) => t.consent_state === "active");
    const totalAlerts = (alerts.data ?? []).filter((a: { acknowledged: boolean }) => !a.acknowledged).length;

    return (
        <MainLayout>
            <div className="space-y-6">
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                            <Cloud className="h-8 w-8 text-primary" />
                            Identity (Microsoft 365)
                        </h1>
                        <p className="text-muted-foreground mt-1 max-w-2xl">
                            Detects identity-layer threats inside Entra ID: suspicious sign-ins,
                            malicious mailbox forwarding rules, MFA changes, privileged role grants,
                            and illicit OAuth consents.
                        </p>
                    </div>
                    <Button
                        onClick={() => startConnect.mutate({ mode: "read_only" })}
                        disabled={startConnect.isPending || !!azureMissing}
                        title={azureMissing ? "Configure the Azure app at Admin → Platform settings before connecting tenants." : undefined}
                    >
                        {startConnect.isPending
                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            : <Cloud className="h-4 w-4 mr-2" />}
                        Connect a Microsoft 365 tenant
                    </Button>
                </div>

                {azureMissing && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Microsoft 365 integration isn't configured</AlertTitle>
                        <AlertDescription className="space-y-2 text-sm">
                            <p>
                                Before any customer tenant can be connected, the platform-wide Azure AD app credentials (client id, client secret, redirect URI) need to be entered. Until they are, the Connect button silently fails because there's nothing to redirect customers to for consent.
                            </p>
                            {isSuperAdmin ? (
                                <Link to="/admin/settings" className="inline-flex items-center gap-1 text-sm font-medium underline">
                                    Open Admin → Platform settings
                                </Link>
                            ) : (
                                <p>Ask a Mithras super-admin to complete the Azure app registration. Once it's saved, the Connect button works for every tenant immediately.</p>
                            )}
                        </AlertDescription>
                    </Alert>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <StatCard icon={<Cloud className="h-5 w-5" />} label="Connected tenants" value={activeTenants.length} />
                    <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Open ITDR alerts" value={totalAlerts} accent />
                    <StatCard icon={<Mail className="h-5 w-5" />} label="External fwd rules" value={(fwdRules.data ?? []).length} accent={!!fwdRules.data?.length} />
                    <StatCard icon={<Key className="h-5 w-5" />} label="High-risk OAuth grants" value={(oauthGrants.data ?? []).length} accent={!!oauthGrants.data?.length} />
                </div>

                {tenants.isLoading ? (
                    <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent></Card>
                ) : activeTenants.length === 0 ? (
                    <EmptyState onConnect={() => startConnect.mutate({ mode: "read_only" })} />
                ) : (
                    <>
                        <TenantList
                            tenants={tenants.data ?? []}
                            onConnectRemediation={(m365TenantId) => startConnect.mutate({ mode: "remediation", m365TenantId })}
                            onRefreshScopes={(m365TenantId) => startConnect.mutate({ mode: "read_only", m365TenantId })}
                        />

                        <Tabs defaultValue="alerts" className="w-full">
                            <TabsList>
                                <TabsTrigger value="alerts">Alerts ({totalAlerts})</TabsTrigger>
                                <TabsTrigger value="signins">Risky sign-ins ({(signIns.data ?? []).length})</TabsTrigger>
                                <TabsTrigger value="forwarding">External forwarding ({(fwdRules.data ?? []).length})</TabsTrigger>
                                <TabsTrigger value="oauth">High-risk OAuth grants ({(oauthGrants.data ?? []).length})</TabsTrigger>
                            </TabsList>
                            <TabsContent value="alerts"><AlertsList rows={alerts.data ?? []} /></TabsContent>
                            <TabsContent value="signins"><SignInsList rows={signIns.data ?? []} /></TabsContent>
                            <TabsContent value="forwarding"><ForwardingList rows={fwdRules.data ?? []} /></TabsContent>
                            <TabsContent value="oauth"><OAuthGrantsList rows={oauthGrants.data ?? []} /></TabsContent>
                        </Tabs>
                    </>
                )}
            </div>
        </MainLayout>
    );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
                        <p className={`text-2xl font-bold mt-1 tabular-nums ${accent && value > 0 ? "text-amber-500" : ""}`}>{value}</p>
                    </div>
                    <div className="text-muted-foreground">{icon}</div>
                </div>
            </CardContent>
        </Card>
    );
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
    return (
        <Card>
            <CardContent className="py-16 text-center max-w-md mx-auto">
                <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-lg font-bold mb-2">Connect a Microsoft 365 tenant to begin</h2>
                <p className="text-muted-foreground text-sm mb-6">
                    Mithras will poll the tenant's Entra ID sign-in logs, directory audit log,
                    mailbox rules, and OAuth grants — read-only — and surface identity threats
                    here. First poll runs within 5 minutes.
                </p>
                <Button onClick={onConnect}>
                    <Cloud className="h-4 w-4 mr-2" />
                    Connect Microsoft 365
                </Button>
                <p className="text-[11px] text-muted-foreground mt-5">
                    Requires a Global Administrator of the M365 tenant to grant consent.
                    Remediation actions are off by default and can be enabled per-tenant.
                </p>
            </CardContent>
        </Card>
    );
}

function TenantList({ tenants, onConnectRemediation, onRefreshScopes }: { tenants: M365Tenant[]; onConnectRemediation: (m365TenantId: string) => void; onRefreshScopes: (m365TenantId: string) => void }) {
    const pollMut = usePollM365Tenant();
    const disconnectMut = useDisconnectM365Tenant();
    const deleteMut = useDeleteM365Tenant();
    const { toast } = useToast();
    const [removeTarget, setRemoveTarget] = useState<M365Tenant | null>(null);
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Connected tenants</CardTitle>
                <CardDescription>One row per Microsoft 365 tenant.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {tenants.map((t) => (
                    <div key={t.id} className="rounded-lg border border-border/40 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold truncate">{t.tenant_display_name ?? t.tenant_id}</span>
                                <Badge variant={t.consent_state === "active" ? "default" : "secondary"}>
                                    {t.consent_state}
                                </Badge>
                                {t.remediation_enabled && (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                                        <ShieldCheck className="h-3 w-3 mr-1" />
                                        remediation
                                    </Badge>
                                )}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono truncate">{t.tenant_id}</div>
                            <div className="text-xs text-muted-foreground">
                                Last poll: {t.last_poll_at ? formatDistanceToNow(new Date(t.last_poll_at), { addSuffix: true }) : "never"}
                            </div>
                            {(() => {
                                const parsed = parsePollError(t.last_poll_error);
                                if (parsed.licenseBlocked.length > 0) {
                                    return (
                                        <div className="text-xs text-muted-foreground">
                                            <span className="text-amber-500">●</span>{" "}
                                            <span className="text-muted-foreground">
                                                {parsed.licenseBlocked.join(" + ")} needs <a href="https://learn.microsoft.com/entra/identity/monitoring-health/concept-sign-ins" target="_blank" rel="noopener" className="underline">Entra ID P1</a>
                                            </span>
                                            {parsed.other && <span className="ml-2 text-amber-500">· error: {parsed.other.slice(0, 80)}{parsed.other.length > 80 ? "…" : ""}</span>}
                                        </div>
                                    );
                                }
                                if (parsed.other) {
                                    return (
                                        <div className="text-xs text-amber-500">
                                            error: {parsed.other.slice(0, 80)}{parsed.other.length > 80 ? "…" : ""}
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline" size="sm"
                                onClick={() => pollMut.mutate(t.id)}
                                disabled={pollMut.isPending || t.consent_state !== "active"}
                            >
                                {pollMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                                Poll now
                            </Button>
                            {t.consent_state === "active" && (
                                <Button
                                    variant="outline" size="sm"
                                    onClick={() => onRefreshScopes(t.id)}
                                    title="Re-run consent for this tenant with the current baseline scope set. Use this after Mithras adds a new scope (e.g. Mail.Read for email security) or if a tenant admin previously denied a scope."
                                >
                                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                    Refresh permissions
                                </Button>
                            )}
                            {!t.remediation_enabled && t.consent_state === "active" && (
                                <Button variant="outline" size="sm" onClick={() => onConnectRemediation(t.id)}>
                                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                                    Enable remediation
                                </Button>
                            )}
                            <Button
                                variant="ghost" size="sm"
                                onClick={() => setRemoveTarget(t)}
                            >
                                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                                Remove
                            </Button>
                        </div>
                    </div>
                ))}
            </CardContent>

            <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Remove {removeTarget?.tenant_display_name ?? removeTarget?.tenant_id}?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="space-y-3">
                            <span className="block">
                                Two options. Neither revokes the Azure-side consent — for that the
                                customer's Global Admin needs to remove the Mithras ITDR app from
                                Entra ID → Enterprise applications.
                            </span>
                            <span className="block rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">
                                <strong className="text-foreground">Disconnect (soft):</strong> tokens cleared,
                                polling stops, consent_state becomes "revoked". The audit row stays so you
                                can see who connected it and when. Re-connecting later reuses the row.
                            </span>
                            <span className="block rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs">
                                <strong className="text-red-500">Delete permanently:</strong> removes the
                                tenant row AND every ingested event (sign-ins, audit, mailbox rules, OAuth
                                grants) and alert derived from this tenant. Cannot be undone.
                            </span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button
                            variant="outline"
                            disabled={disconnectMut.isPending || deleteMut.isPending}
                            onClick={() => {
                                if (!removeTarget) return;
                                disconnectMut.mutate(removeTarget.id, {
                                    onSuccess: () => {
                                        toast({ title: `Disconnected ${removeTarget.tenant_display_name ?? removeTarget.tenant_id}` });
                                        setRemoveTarget(null);
                                    },
                                });
                            }}
                        >
                            Disconnect
                        </Button>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={disconnectMut.isPending || deleteMut.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                if (!removeTarget) return;
                                deleteMut.mutate(removeTarget.id, {
                                    onSuccess: () => {
                                        toast({ title: `Deleted ${removeTarget.tenant_display_name ?? removeTarget.tenant_id} and all telemetry` });
                                        setRemoveTarget(null);
                                    },
                                });
                            }}
                        >
                            Delete permanently
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

function SeverityBadge({ s }: { s: string }) {
    const cls = s === "critical" ? "bg-red-500/20 text-red-500 border-red-500/40"
        : s === "high" ? "bg-orange-500/20 text-orange-500 border-orange-500/40"
        : s === "medium" ? "bg-amber-500/20 text-amber-500 border-amber-500/40"
        : "bg-muted text-muted-foreground";
    return <Badge variant="outline" className={cls}>{s}</Badge>;
}

interface AlertRow {
    id: string;
    severity: string;
    alert_type: string;
    title: string;
    message: string;
    created_at: string;
    acknowledged: boolean;
}

function AlertsList({ rows }: { rows: AlertRow[] }) {
    if (rows.length === 0) return <EmptyTab message="No M365 alerts yet. Detections fire as soon as the poller ingests qualifying events." />;
    return (
        <div className="space-y-2 mt-4">
            {rows.map((a) => (
                <div key={a.id} className={`rounded-lg border p-4 ${a.acknowledged ? "opacity-60 border-border/40" : "border-border/60 bg-card"}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <SeverityBadge s={a.severity} />
                                <span className="text-xs text-muted-foreground font-mono">{a.alert_type}</span>
                                {a.acknowledged && <Badge variant="secondary" className="text-[10px]">ack'd</Badge>}
                            </div>
                            <div className="font-semibold">{a.title}</div>
                            <div className="text-sm text-muted-foreground leading-relaxed">{a.message}</div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

interface SignInRow {
    id: string;
    user_principal_name: string | null;
    app_display_name: string | null;
    ip_address: string | null;
    country: string | null;
    city: string | null;
    risk_level: string | null;
    risk_event_types: string[] | null;
    occurred_at: string;
}

function SignInsList({ rows }: { rows: SignInRow[] }) {
    if (rows.length === 0) return <EmptyTab message="No risky sign-ins recorded yet." />;
    return (
        <div className="rounded-lg border border-border/40 mt-4 overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr><th className="text-left p-3">When</th><th className="text-left p-3">User</th><th className="text-left p-3">App</th><th className="text-left p-3">Source</th><th className="text-left p-3">Risk</th></tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} className="border-t border-border/40">
                            <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.occurred_at), "dd MMM HH:mm")}</td>
                            <td className="p-3">{r.user_principal_name ?? "—"}</td>
                            <td className="p-3 text-muted-foreground">{r.app_display_name ?? "—"}</td>
                            <td className="p-3 text-xs text-muted-foreground">{[r.ip_address, r.city, r.country].filter(Boolean).join(" · ") || "—"}</td>
                            <td className="p-3"><SeverityBadge s={r.risk_level ?? "none"} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

interface FwdRow {
    id: string;
    user_principal_name: string;
    rule_name: string | null;
    forward_to_addresses: string[] | null;
    last_seen_at: string;
}

function ForwardingList({ rows }: { rows: FwdRow[] }) {
    if (rows.length === 0) return <EmptyTab message="No external mailbox forwarding rules detected. This is good — these are the strongest single signal of business email compromise." />;
    return (
        <div className="space-y-2 mt-4">
            {rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="font-semibold">{r.user_principal_name}</div>
                            <div className="text-sm text-muted-foreground">Rule: "{r.rule_name ?? "(unnamed)"}"</div>
                            <div className="text-sm font-mono mt-1.5">→ {(r.forward_to_addresses ?? []).join(", ")}</div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true })}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

interface OAuthRow {
    id: string;
    client_display_name: string | null;
    client_id: string;
    principal_upn: string | null;
    consent_type: string | null;
    high_risk_scopes_matched: string[] | null;
    scope: string | null;
    last_seen_at: string;
}

function OAuthGrantsList({ rows }: { rows: OAuthRow[] }) {
    if (rows.length === 0) return <EmptyTab message="No high-risk OAuth grants detected." />;
    return (
        <div className="space-y-2 mt-4">
            {rows.map((g) => (
                <div key={g.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="font-semibold truncate">{g.client_display_name ?? g.client_id}</div>
                            <div className="text-xs text-muted-foreground font-mono">{g.client_id}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                                {g.consent_type === "AllPrincipals" ? "Tenant-wide consent" : `User consent: ${g.principal_upn ?? "—"}`}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                                {(g.high_risk_scopes_matched ?? []).map((s) => (
                                    <Badge key={s} variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">{s}</Badge>
                                ))}
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(g.last_seen_at), { addSuffix: true })}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyTab({ message }: { message: string }) {
    return (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground mt-4">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500" />
            {message}
        </div>
    );
}
