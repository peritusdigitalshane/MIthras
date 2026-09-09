import { useEffect, useMemo, useState } from "react";
import { Brain, Loader2, Info, ShieldCheck, FileText, Mail, ServerCog } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUpdateOrganizationAiSoc } from "@/hooks/useSuperAdmin";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AiSocOrgDialogTarget {
    id: string;
    name: string;
    ai_triage_enabled: boolean;
    ai_investigation_enabled: boolean;
    ai_soc_daily_cap_cents: number;
    ai_email_remediation_enabled: boolean;
    ai_endpoint_remediation_enabled: boolean;
}

interface Props {
    target: AiSocOrgDialogTarget | null;
    onClose: () => void;
}

/**
 * Per-customer AI SOC settings dialog. Independent toggles per agent so
 * the MSP can tier customers:
 *   - triage only → human reviews + decides escalation
 *   - triage + investigation → AI builds full incident reports
 *   - + email remediation → AI auto-quarantines flagged mail
 *   - + endpoint remediation → AI auto-isolates / kills / quarantines on
 *                              the box, with rollback timer
 *
 * Email and endpoint remediation are independent — a customer can have
 * one without the other. Both gate ONLY autonomous actions; operator
 * clicks are always allowed.
 *
 * Daily cost cap pools across all agents.
 */
export function AiSocOrgDialog({ target, onClose }: Props) {
    const update = useUpdateOrganizationAiSoc();
    const [triageEnabled, setTriageEnabled] = useState(false);
    const [investigationEnabled, setInvestigationEnabled] = useState(false);
    const [emailRemediationEnabled, setEmailRemediationEnabled] = useState(false);
    const [endpointRemediationEnabled, setEndpointRemediationEnabled] = useState(false);
    const [capDollars, setCapDollars] = useState<string>("5");
    const [acknowledgeNotified, setAcknowledgeNotified] = useState(false);

    const stats = useQuery({
        queryKey: ["ai-soc-org-stats", target?.id],
        queryFn: async () => {
            if (!target) return null;
            const todayIso = (() => {
                const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
            })();
            const [{ count: triages }, { count: investigations }, { data: triageCosts }, { data: investCosts }] = await Promise.all([
                supabase.from("ai_triage_decisions").select("*", { count: "exact", head: true })
                    .eq("organization_id", target.id).gte("created_at", todayIso),
                supabase.from("ai_investigations").select("*", { count: "exact", head: true })
                    .eq("organization_id", target.id).gte("created_at", todayIso),
                supabase.from("ai_triage_decisions").select("cost_cents")
                    .eq("organization_id", target.id).gte("created_at", todayIso),
                supabase.from("ai_investigations").select("cost_cents")
                    .eq("organization_id", target.id).gte("created_at", todayIso),
            ]);
            const spendCents =
                (triageCosts ?? []).reduce((s: number, r: { cost_cents: number }) => s + (r.cost_cents ?? 0), 0)
                + (investCosts ?? []).reduce((s: number, r: { cost_cents: number }) => s + (r.cost_cents ?? 0), 0);
            return { triages: triages ?? 0, investigations: investigations ?? 0, spendCents };
        },
        enabled: !!target,
    });

    useEffect(() => {
        if (target) {
            setTriageEnabled(target.ai_triage_enabled);
            setInvestigationEnabled(target.ai_investigation_enabled);
            setEmailRemediationEnabled(target.ai_email_remediation_enabled);
            setEndpointRemediationEnabled(target.ai_endpoint_remediation_enabled);
            setCapDollars(((target.ai_soc_daily_cap_cents ?? 500) / 100).toFixed(2));
            setAcknowledgeNotified(false);
        }
    }, [target?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Constraint cascade: each agent depends on the one above. Flipping a
    // dependency off auto-disables everything downstream so the UI never
    // shows an impossible state.
    //   triage off          → investigation off, email-remediation off
    //   investigation off   → endpoint-remediation off
    useEffect(() => {
        if (!triageEnabled) {
            if (investigationEnabled)  setInvestigationEnabled(false);
            if (emailRemediationEnabled) setEmailRemediationEnabled(false);
        }
        if (!investigationEnabled && endpointRemediationEnabled) {
            setEndpointRemediationEnabled(false);
        }
    }, [triageEnabled, investigationEnabled, emailRemediationEnabled, endpointRemediationEnabled]);

    const capCents = useMemo(() => {
        const parsed = Number.parseFloat(capDollars);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return Math.round(parsed * 100);
    }, [capDollars]);

    const wasOff = target
        && !target.ai_triage_enabled
        && !target.ai_investigation_enabled
        && !target.ai_email_remediation_enabled
        && !target.ai_endpoint_remediation_enabled;
    const willBeOn = triageEnabled
        || investigationEnabled
        || emailRemediationEnabled
        || endpointRemediationEnabled;
    const isTurningOn = wasOff && willBeOn;
    const hasChanges = target && (
        triageEnabled !== target.ai_triage_enabled ||
        investigationEnabled !== target.ai_investigation_enabled ||
        emailRemediationEnabled !== target.ai_email_remediation_enabled ||
        endpointRemediationEnabled !== target.ai_endpoint_remediation_enabled ||
        capCents !== target.ai_soc_daily_cap_cents
    );
    const canSave = target != null
        && capCents !== null
        && hasChanges
        && (!isTurningOn || acknowledgeNotified);

    const handleSave = async () => {
        if (!target || capCents === null) return;
        try {
            await update.mutateAsync({
                id: target.id,
                aiTriageEnabled: triageEnabled,
                aiInvestigationEnabled: investigationEnabled,
                aiSocDailyCapCents: capCents,
                aiEmailRemediationEnabled: emailRemediationEnabled,
                aiEndpointRemediationEnabled: endpointRemediationEnabled,
            });
            toast.success(
                willBeOn
                    ? `AI SOC updated for ${target.name}`
                    : `AI SOC disabled for ${target.name}`,
            );
            onClose();
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };

    return (
        <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-primary" />
                        AI SOC — {target?.name}
                    </DialogTitle>
                    <DialogDescription>
                        Enable one or both AI agents for this customer. Each one is independent.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                        <Stat label="Triages today" value={stats.data?.triages ?? (stats.isLoading ? "…" : 0)} />
                        <Stat label="Investigations" value={stats.data?.investigations ?? (stats.isLoading ? "…" : 0)} />
                        <Stat
                            label="Spend today"
                            value={stats.data ? `$${(stats.data.spendCents / 100).toFixed(2)}` : stats.isLoading ? "…" : "$0.00"}
                        />
                    </div>

                    {/* AGENT 1 — TRIAGE */}
                    <AgentToggle
                        icon={<ShieldCheck className="h-4 w-4" />}
                        title="AI Triage Agent"
                        description="Classifies every new alert as true positive / false positive / needs human. Auto-closes high-confidence false positives. Surfaces verdicts + cited reasoning on the alert + SOC console."
                        checked={triageEnabled}
                        onChange={setTriageEnabled}
                    />

                    {/* AGENT 2 — INVESTIGATION */}
                    <AgentToggle
                        icon={<FileText className="h-4 w-4" />}
                        title="AI Investigation Agent"
                        description="When triage hits true positive at high confidence, autonomously builds the full incident: timeline, affected assets, containment recommendations, and a customer-ready report."
                        checked={investigationEnabled}
                        onChange={setInvestigationEnabled}
                        disabled={!triageEnabled}
                        disabledReason="Triage must be enabled to escalate to Investigation."
                    />

                    {/* AGENT 3a — EMAIL REMEDIATION */}
                    <AgentToggle
                        icon={<Mail className="h-4 w-4" />}
                        title="AI Email Remediation"
                        description="When a flagged message is high-confidence phishing or malware, auto-quarantines it without an operator click. Block rules with kind=quarantine also fire automatically on matching mail."
                        checked={emailRemediationEnabled}
                        onChange={setEmailRemediationEnabled}
                        disabled={!triageEnabled}
                        disabledReason="Triage must be enabled — remediation acts on its verdicts."
                    />

                    {/* AGENT 3b — ENDPOINT REMEDIATION */}
                    <AgentToggle
                        icon={<ServerCog className="h-4 w-4" />}
                        title="AI Endpoint Remediation"
                        description="When the Response Agent's consensus is high (default ≥0.85), auto-executes recommended actions (isolate host, kill process, quarantine file, run scan). Auto-rollback timer arms in parallel so a misfire reverses itself."
                        checked={endpointRemediationEnabled}
                        onChange={setEndpointRemediationEnabled}
                        disabled={!investigationEnabled}
                        disabledReason="Investigation must be enabled — endpoint actions need the full incident context."
                    />

                    {/* COST CAP */}
                    <div className="space-y-1.5 rounded-lg border border-border/40 p-3">
                        <Label htmlFor="ai-soc-cap" className="text-sm font-medium">
                            Daily cost cap (USD)
                        </Label>
                        <Input
                            id="ai-soc-cap"
                            type="number"
                            step="0.5"
                            min="0"
                            value={capDollars}
                            onChange={(e) => setCapDollars(e.target.value)}
                            className="font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Pools across all agents. Resets 00:00 UTC. At gpt-5-mini
                            pricing, $5 ≈ 6,000 triages OR 100 investigations.
                        </p>
                    </div>

                    {/* CONSENT */}
                    {isTurningOn && (
                        <Alert>
                            <Info className="h-4 w-4" />
                            <AlertTitle className="text-sm">Customer consent reminder</AlertTitle>
                            <AlertDescription className="text-xs space-y-2 mt-1">
                                <p>
                                    Enabling AI processes this customer's alert + endpoint telemetry
                                    via OpenAI. Confirm they've been informed in writing and the AI
                                    add-on is in their contract.
                                </p>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={acknowledgeNotified}
                                        onChange={(e) => setAcknowledgeNotified(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span>I've informed the customer.</span>
                                </label>
                            </AlertDescription>
                        </Alert>
                    )}

                    {target && (
                        target.ai_triage_enabled
                        || target.ai_investigation_enabled
                        || target.ai_email_remediation_enabled
                        || target.ai_endpoint_remediation_enabled
                    ) && (
                        <div className="flex flex-wrap gap-1">
                            {target.ai_triage_enabled && (
                                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                                    Triage on
                                </Badge>
                            )}
                            {target.ai_investigation_enabled && (
                                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                                    Investigation on
                                </Badge>
                            )}
                            {target.ai_email_remediation_enabled && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                                    Email auto-remediate
                                </Badge>
                            )}
                            {target.ai_endpoint_remediation_enabled && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                                    Endpoint auto-remediate
                                </Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">
                                cap ${((target.ai_soc_daily_cap_cents ?? 500) / 100).toFixed(2)}/day
                            </Badge>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={!canSave || update.isPending}>
                        {update.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Stat({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-base font-bold tabular-nums">{value}</div>
        </div>
    );
}

interface AgentToggleProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    disabledReason?: string;
    comingSoon?: boolean;
}

function AgentToggle({ icon, title, description, checked, onChange, disabled, disabledReason, comingSoon }: AgentToggleProps) {
    return (
        <div className={`rounded-lg border border-border/40 p-3 ${disabled ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-primary">{icon}</span>
                        <span className="text-sm font-semibold">{title}</span>
                        {comingSoon && (
                            <Badge variant="outline" className="text-[10px]">coming soon</Badge>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
                    {disabled && disabledReason && (
                        <p className="text-[10px] text-amber-500 mt-1.5">{disabledReason}</p>
                    )}
                </div>
                <Switch
                    checked={checked}
                    onCheckedChange={onChange}
                    disabled={disabled}
                    className="mt-0.5"
                />
            </div>
        </div>
    );
}
