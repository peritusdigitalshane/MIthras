import { useState } from "react";
import { usePlanFeatures, SubscriptionPlan } from "@/hooks/useSubscriptionPlans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Check, Zap, Building2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const planIcons: Record<SubscriptionPlan, React.ReactNode> = {
  free: <Zap className="h-5 w-5" />,
  pro: <Sparkles className="h-5 w-5" />,
  business: <Building2 className="h-5 w-5" />,
};

const planColors: Record<SubscriptionPlan, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-primary/10 text-primary",
  business: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const planLabels: Record<SubscriptionPlan, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

const featureLabels: Record<string, string> = {
  max_devices: "Max Devices",
  ai_security_advisor: "AI Security Advisor",
  compliance_reporting: "Compliance Reporting",
  advanced_threat_analytics: "Advanced Threat Analytics",
  custom_policies: "Custom Policies",
  priority_support: "Priority Support",
  api_access: "API Access",
};

export function SubscriptionPlansSection() {
  const { data: plans, isLoading } = usePlanFeatures();
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [editedFeatures, setEditedFeatures] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleEdit = (plan: SubscriptionPlan, features: Record<string, any>) => {
    setEditingPlan(plan);
    setEditedFeatures({ ...features });
  };

  const handleCancel = () => {
    setEditingPlan(null);
    setEditedFeatures({});
  };

  const handleSave = async (planId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("plan_features")
        .update({
          max_devices: editedFeatures.max_devices === "" ? null : parseInt(editedFeatures.max_devices) || null,
          ai_security_advisor: editedFeatures.ai_security_advisor,
          compliance_reporting: editedFeatures.compliance_reporting,
          advanced_threat_analytics: editedFeatures.advanced_threat_analytics,
          custom_policies: editedFeatures.custom_policies,
          priority_support: editedFeatures.priority_support,
          api_access: editedFeatures.api_access,
        })
        .eq("id", planId);

      if (error) throw error;

      toast.success("Plan features updated");
      queryClient.invalidateQueries({ queryKey: ["plan-features"] });
      handleCancel();
    } catch (error: any) {
      toast.error(error.message || "Failed to update plan");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Subscription Plans</h3>
        <p className="text-sm text-muted-foreground">
          Configure features and limits for each plan tier
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans?.map((plan) => {
          const isEditing = editingPlan === plan.plan;

          return (
            <Card key={plan.id} className={isEditing ? "ring-2 ring-primary" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className={planColors[plan.plan]}>
                    {planIcons[plan.plan]}
                    <span className="ml-1">{planLabels[plan.plan]}</span>
                  </Badge>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(plan.plan, plan)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                <CardTitle className="mt-2">
                  {planLabels[plan.plan]} Plan
                </CardTitle>
                <CardDescription>
                  {plan.plan === "free" && "For individuals getting started"}
                  {plan.plan === "pro" && "For growing teams"}
                  {plan.plan === "business" && "For enterprises & partners"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Max Devices */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{featureLabels.max_devices}</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      className="w-24"
                      placeholder="Unlimited"
                      value={editedFeatures.max_devices ?? ""}
                      onChange={(e) =>
                        setEditedFeatures((prev) => ({
                          ...prev,
                          max_devices: e.target.value,
                        }))
                      }
                    />
                  ) : (
                    <span className="text-sm font-medium">
                      {plan.max_devices ?? "Unlimited"}
                    </span>
                  )}
                </div>

                {/* Boolean Features */}
                {Object.entries(featureLabels)
                  .filter(([key]) => key !== "max_devices")
                  .map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label className="text-sm">{label}</Label>
                      {isEditing ? (
                        <Switch
                          checked={editedFeatures[key] ?? false}
                          onCheckedChange={(checked) =>
                            setEditedFeatures((prev) => ({
                              ...prev,
                              [key]: checked,
                            }))
                          }
                        />
                      ) : (
                        <span>
                          {(plan as any)[key] ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      )}
                    </div>
                  ))}

                {isEditing && (
                  <div className="flex gap-2 pt-4">
                    <Button
                      size="sm"
                      onClick={() => handleSave(plan.id)}
                      disabled={saving}
                    >
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> Partners and their managed customers automatically
            receive Business plan features regardless of their assigned plan.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
