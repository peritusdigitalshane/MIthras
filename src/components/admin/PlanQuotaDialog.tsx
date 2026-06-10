import { useEffect, useState } from "react";
import { CreditCard, Loader2, Info, AlertTriangle } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUpdateOrganizationPlan, useOrganizationDeviceQuota } from "@/hooks/useSuperAdmin";
import { toast } from "sonner";

export interface PlanQuotaDialogTarget {
    id: string;
    name: string;
    subscription_plan: "free" | "pro" | "business";
    device_quota_override: number | null;
    is_partner_child: boolean;
}

interface Props {
    target: PlanQuotaDialogTarget | null;
    onClose: () => void;
}

const PLAN_LABEL: Record<string, string> = {
    free: "Free (default cap 1 endpoint)",
    pro: "Pro (default cap 25 endpoints)",
    business: "Business (unlimited)",
};
const PLAN_DEFAULTS: Record<string, number | null> = {
    free: 1,
    pro: 25,
    business: null,
};

/**
 * Per-customer subscription plan + optional device-quota override. The
 * effective cap is the override when set, otherwise the plan's default.
 * Partner-child orgs bypass quotas entirely and surface a different
 * info banner explaining why.
 */
export function PlanQuotaDialog({ target, onClose }: Props) {
    const update = useUpdateOrganizationPlan();
    const quota = useOrganizationDeviceQuota(target?.id);
    const [plan, setPlan] = useState<"free" | "pro" | "business">("free");
    const [useOverride, setUseOverride] = useState(false);
    const [overrideValue, setOverrideValue] = useState<string>("");

    useEffect(() => {
        if (target) {
            setPlan(target.subscription_plan);
            const hasOverride = target.device_quota_override !== null && target.device_quota_override !== undefined;
            setUseOverride(hasOverride);
            setOverrideValue(hasOverride ? String(target.device_quota_override) : "");
        }
    }, [target?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const overrideInt = (() => {
        const n = Number.parseInt(overrideValue, 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
    })();

    const liveUsed = quota.data?.used ?? 0;
    const planDefault = PLAN_DEFAULTS[plan];
    const effectiveCap = useOverride && overrideInt !== null ? overrideInt : planDefault;
    const wouldLockOut = useOverride && overrideInt !== null && overrideInt < liveUsed;

    const hasChanges = target && (
        plan !== target.subscription_plan ||
        useOverride !== (target.device_quota_override !== null) ||
        (useOverride && overrideInt !== target.device_quota_override)
    );
    const canSave = target != null && hasChanges && !(useOverride && overrideInt === null);

    const handleSave = async () => {
        if (!target) return;
        try {
            await update.mutateAsync({
                id: target.id,
                subscriptionPlan: plan,
                // null clears the override; explicit int sets it; undefined would leave it alone (we don't use that here)
                deviceQuotaOverride: useOverride ? overrideInt! : null,
            });
            toast.success(`Plan updated for ${target.name}`);
            onClose();
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };

    return (
        <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        Plan &amp; quota — {target?.name}
                    </DialogTitle>
                    <DialogDescription>
                        Set the subscription tier and (optionally) cap device enrolments at a
                        custom number.
                    </DialogDescription>
                </DialogHeader>

                {target?.is_partner_child && (
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle className="text-sm">This is a partner-child customer</AlertTitle>
                        <AlertDescription className="text-xs">
                            Partner-child orgs inherit unlimited device quota from their MSP and
                            bypass this gate entirely. Setting a plan here is informational only
                            until you detach the customer from their partner.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Tile label="Endpoints used" value={liveUsed} />
                        <Tile
                            label="Effective cap"
                            value={effectiveCap === null ? "unlimited" : effectiveCap}
                            accent={wouldLockOut ? "danger" : undefined}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="plan-select" className="text-sm font-medium">Subscription plan</Label>
                        <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                            <SelectTrigger id="plan-select"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {(["free", "pro", "business"] as const).map((p) => (
                                    <SelectItem key={p} value={p}>{PLAN_LABEL[p]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">
                            The plan determines the default device cap. Use the override below to
                            set a custom number that wins over the plan default.
                        </p>
                    </div>

                    <div className="rounded-lg border border-border/40 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="use-override" className="text-sm font-medium">
                                Custom device quota
                            </Label>
                            <Switch
                                id="use-override"
                                checked={useOverride}
                                onCheckedChange={(v) => {
                                    setUseOverride(v);
                                    if (!v) setOverrideValue("");
                                }}
                            />
                        </div>
                        {useOverride && (
                            <div className="space-y-1.5">
                                <Input
                                    id="override-value"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={overrideValue}
                                    onChange={(e) => setOverrideValue(e.target.value)}
                                    placeholder="e.g. 50"
                                    className="font-mono"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Cap this customer at exactly this number of live endpoints. Use 0 to lock all new enrolments.
                                </p>
                            </div>
                        )}
                    </div>

                    {wouldLockOut && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle className="text-sm">Cap is below current usage</AlertTitle>
                            <AlertDescription className="text-xs">
                                The customer already has {liveUsed} live endpoint{liveUsed === 1 ? "" : "s"} —
                                setting the cap to {overrideInt} won't disconnect them, but no new
                                enrolments will succeed until usage drops below the cap.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">
                            current: {target?.subscription_plan}
                        </Badge>
                        {target?.device_quota_override !== null && target?.device_quota_override !== undefined && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                                override active: {target.device_quota_override}
                            </Badge>
                        )}
                    </div>
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

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: "danger" }) {
    const c = accent === "danger" ? "text-red-500" : "";
    return (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-lg font-bold tabular-nums mt-0.5 ${c}`}>{value}</div>
        </div>
    );
}
