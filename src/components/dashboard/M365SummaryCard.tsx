import { Link } from "react-router-dom";
import { Cloud, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useM365Tenants, useM365ForwardingRules, useM365HighRiskOAuthGrants } from "@/hooks/useM365";
import { useSocCounters } from "@/hooks/useSocDashboard";

/**
 * Customer-dashboard view of the M365 / Entra ID integration. Three states:
 *   - not connected → CTA to set it up
 *   - connected, clean → green tick
 *   - connected, with findings → counts + drill-in link
 */
export function M365SummaryCard() {
    const tenants = useM365Tenants();
    const fwd = useM365ForwardingRules();
    const oauth = useM365HighRiskOAuthGrants();
    const counters = useSocCounters();

    const active = (tenants.data ?? []).filter((t) => t.consent_state === "active");
    const isLoading = tenants.isLoading || fwd.isLoading || oauth.isLoading;
    const fwdCount = (fwd.data ?? []).length;
    const oauthCount = (oauth.data ?? []).length;
    const riskySignIns = counters.data?.m365RiskySignIns24h ?? 0;
    const totalFindings = fwdCount + oauthCount + riskySignIns;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Cloud className="h-4 w-4 text-primary" />
                    Microsoft 365 / Entra ID
                </CardTitle>
                <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                    <Link to="/m365">
                        Open Identity
                        <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : active.length === 0 ? (
                    <div className="text-center py-3">
                        <Cloud className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
                        <p className="text-sm text-muted-foreground mb-3">
                            No Microsoft 365 tenant connected yet.
                        </p>
                        <Button asChild size="sm" variant="outline">
                            <Link to="/m365">Connect Microsoft 365</Link>
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-3 mb-3">
                            <Tile label="Connected tenants" value={active.length} />
                            <Tile label="Risky sign-ins 24h" value={riskySignIns} accent={riskySignIns > 0 ? "warning" : undefined} />
                            <Tile label="External fwd rules" value={fwdCount} accent={fwdCount > 0 ? "danger" : undefined} />
                        </div>
                        {totalFindings === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-emerald-500">
                                <CheckCircle2 className="h-4 w-4" />
                                No active identity findings.
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-xs text-amber-500">
                                <AlertTriangle className="h-4 w-4" />
                                {totalFindings} active finding{totalFindings === 1 ? "" : "s"} — review on the Identity page.
                            </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-1">
                            {active.slice(0, 3).map((t) => (
                                <Badge key={t.id} variant="outline" className="text-[10px]">
                                    {t.tenant_display_name ?? t.tenant_id.slice(0, 8)}
                                    {t.remediation_enabled && <span className="ml-1 text-emerald-500">·R</span>}
                                </Badge>
                            ))}
                            {active.length > 3 && (
                                <Badge variant="outline" className="text-[10px]">+{active.length - 3}</Badge>
                            )}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: "warning" | "danger" }) {
    const c = accent === "danger" ? "text-red-500" : accent === "warning" ? "text-amber-500" : "";
    return (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-xl font-bold tabular-nums mt-0.5 ${c}`}>{value}</div>
        </div>
    );
}
