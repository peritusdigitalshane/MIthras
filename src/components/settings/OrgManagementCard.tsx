import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Building2, LogOut, Loader2, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Org-level management: rename (admin only) + leave (any member).
 *
 * Leaving rules:
 *   - A regular member can leave at any time.
 *   - An owner can leave only if there is another owner of the same org. The
 *     server enforces this with the `last_owner_leaving` RPC error; we surface
 *     it as a clear toast.
 */
export function OrgManagementCard() {
  const { currentOrganization } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    setName(currentOrganization?.name ?? "");
  }, [currentOrganization?.id, currentOrganization?.name]);

  // Look up the current user's role + count of owners so we can disable Leave
  // for the last-owner case before the request ever fires.
  const { data: roleInfo } = useQuery({
    queryKey: ["my-membership", currentOrganization?.id, user?.id],
    enabled: !!currentOrganization?.id && !!user?.id,
    queryFn: async () => {
      const [meRes, ownerCountRes] = await Promise.all([
        supabase
          .from("organization_memberships")
          .select("role")
          .eq("organization_id", currentOrganization!.id)
          .eq("user_id", user!.id)
          .maybeSingle(),
        supabase
          .from("organization_memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", currentOrganization!.id)
          .eq("role", "owner"),
      ]);
      return {
        myRole: meRes.data?.role as "owner" | "admin" | "member" | undefined,
        ownerCount: ownerCountRes.count ?? 0,
      };
    },
  });

  const canRename = roleInfo?.myRole === "owner" || roleInfo?.myRole === "admin";
  const isLastOwner = roleInfo?.myRole === "owner" && roleInfo.ownerCount <= 1;

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organisation selected");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name can't be empty");
      const { error } = await supabase
        .from("organizations")
        .update({ name: trimmed })
        .eq("id", currentOrganization.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["current-organization"] });
      toast({ title: "Organisation renamed" });
      // TenantContext caches org name in React state at load time. Simplest
      // way to pick up the new value across header / sidebar / embedded
      // components is a soft reload on the same route.
      window.setTimeout(() => window.location.reload(), 600);
    },
    onError: (e: Error) =>
      toast({ title: "Rename failed", description: e.message, variant: "destructive" }),
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id || !user?.id) throw new Error("No session");
      const { error } = await supabase
        .from("organization_memberships")
        .delete()
        .eq("organization_id", currentOrganization.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({ title: "Left organisation" });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      // Hard reload so TenantContext picks up the new list and routes.
      window.setTimeout(() => navigate("/dashboard", { replace: true }), 100);
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't leave", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Organisation</CardTitle>
            <CardDescription>
              Rename your organisation or leave it. Admins + owners can rename.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2 max-w-sm">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canRename}
          />
          <div className="text-xs text-muted-foreground">
            Slug stays the same — only the display name changes. Shown to your
            customers in branded reports.
          </div>
          {canRename && (
            <Button
              onClick={() => renameMutation.mutate()}
              disabled={
                renameMutation.isPending ||
                !name.trim() ||
                name.trim() === currentOrganization?.name
              }
              className="w-fit"
            >
              {renameMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium text-sm">Leave organisation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You'll lose access to this organisation's endpoints, policies,
                and reports.
                {roleInfo?.myRole && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    Your role: {roleInfo.myRole}
                  </Badge>
                )}
              </p>
              {isLastOwner && (
                <p className="text-xs text-destructive mt-2">
                  You're the only owner. Promote another member to owner before
                  leaving.
                </p>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={isLastOwner}
              onClick={() => setConfirmLeave(true)}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Leave
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {currentOrganization?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your membership immediately. To rejoin you'll need a new
              enrollment code from a remaining admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                leaveMutation.mutate();
                setConfirmLeave(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
