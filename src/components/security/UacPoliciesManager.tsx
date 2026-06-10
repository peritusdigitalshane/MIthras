import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus, 
  ShieldCheck, 
  ShieldAlert, 
  Edit, 
  Trash2, 
  MoreVertical,
  Users,
  Info 
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  useUacPolicies, 
  useDeleteUacPolicy,
  UAC_ADMIN_PROMPTS,
  type UacPolicy 
} from "@/hooks/useUacPolicies";
import { UacPolicyDialog } from "./UacPolicyDialog";

export function UacPoliciesManager() {
  const { data: policies, isLoading } = useUacPolicies();
  const deletePolicy = useDeleteUacPolicy();
  const [editingPolicy, setEditingPolicy] = useState<UacPolicy | null>(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleDelete = async () => {
    if (deletingPolicyId) {
      await deletePolicy.mutateAsync({ id: deletingPolicyId });
      setDeletingPolicyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">UAC Policies</h2>
          <p className="text-sm text-muted-foreground">
            Define User Account Control settings for your endpoints
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Policy
        </Button>
      </div>

      {/* Policies Grid */}
      {!policies?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No UAC Policies</h3>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">
              Create a UAC policy to define User Account Control settings that can be 
              applied to endpoints in your organization.
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Policy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {policies.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onEdit={() => setEditingPolicy(policy)}
              onDelete={() => setDeletingPolicyId(policy.id)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <UacPolicyDialog
        open={isCreateOpen || !!editingPolicy}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingPolicy(null);
          }
        }}
        policy={editingPolicy}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingPolicyId} onOpenChange={(open) => !open && setDeletingPolicyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete UAC Policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the policy. Endpoints using this policy will no longer 
              have a UAC configuration assigned and will use their local settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PolicyCard({ 
  policy, 
  onEdit, 
  onDelete 
}: { 
  policy: UacPolicy; 
  onEdit: () => void; 
  onDelete: () => void;
}) {
  const adminPromptInfo = UAC_ADMIN_PROMPTS[policy.consent_prompt_admin] || { label: "Unknown", description: "" };
  const securityLevel = getSecurityLevel(policy);

  return (
    <Card className="relative group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {policy.enable_lua ? (
              <ShieldCheck className="h-5 w-5 text-status-healthy" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-status-critical" />
            )}
            <div>
              <CardTitle className="text-base">{policy.name}</CardTitle>
              {policy.is_default && (
                <Badge variant="secondary" className="text-[10px] mt-1">Default</Badge>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Policy options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {policy.description && (
          <CardDescription className="line-clamp-2 text-xs mt-1">
            {policy.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Security Level Badge */}
        <div className="flex items-center gap-2">
          <Badge variant={securityLevel.variant as any} className="text-xs">
            {securityLevel.label}
          </Badge>
        </div>

        {/* Key Settings */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">UAC Enabled</span>
            <Badge variant={policy.enable_lua ? "default" : "destructive"} className="text-[10px]">
              {policy.enable_lua ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Admin Prompt</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <span className="text-foreground truncate max-w-[140px]">
                      {adminPromptInfo.label}
                    </span>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  {adminPromptInfo.description}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Secure Desktop</span>
            <Badge variant={policy.prompt_on_secure_desktop ? "default" : "secondary"} className="text-[10px]">
              {policy.prompt_on_secure_desktop ? "Yes" : "No"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getSecurityLevel(policy: UacPolicy): { label: string; variant: string } {
  if (!policy.enable_lua) {
    return { label: "Disabled", variant: "destructive" };
  }
  
  // High security: consent prompt >= 2, secure desktop on, validate signatures
  if (
    policy.consent_prompt_admin >= 2 &&
    policy.prompt_on_secure_desktop &&
    policy.validate_admin_signatures
  ) {
    return { label: "High Security", variant: "default" };
  }
  
  // Medium security: consent prompt >= 2 or secure desktop on
  if (policy.consent_prompt_admin >= 2 || policy.prompt_on_secure_desktop) {
    return { label: "Medium Security", variant: "secondary" };
  }
  
  // Low security
  return { label: "Low Security", variant: "outline" };
}
