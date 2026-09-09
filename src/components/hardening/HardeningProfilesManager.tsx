import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHardeningProfiles, useDeleteHardeningProfile } from "@/hooks/useHardening";
import { Shield, ShieldCheck, Trash2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

const OS_TARGET_LABELS: Record<string, string> = {
  all: "All Legacy OS",
  win10: "Windows 10",
  server2012r2: "Server 2012 R2",
  server2012: "Server 2012",
  win7: "Windows 7",
  win81: "Windows 8.1",
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  defender: { label: "Defender", color: "bg-blue-500/10 text-blue-600" },
  network: { label: "Network", color: "bg-purple-500/10 text-purple-600" },
  services: { label: "Services", color: "bg-orange-500/10 text-orange-600" },
  authentication: { label: "Authentication", color: "bg-rose-500/10 text-rose-600" },
  application_control: { label: "App Control", color: "bg-emerald-500/10 text-emerald-600" },
  encryption: { label: "Encryption", color: "bg-cyan-500/10 text-cyan-600" },
};

export function HardeningProfilesManager() {
  const { data: profiles, isLoading } = useHardeningProfiles();
  const deleteProfile = useDeleteHardeningProfile();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProfile.mutateAsync(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({ title: "Failed to delete", description: e.message, variant: "destructive" });
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Hardening Profiles</h3>
          <p className="text-sm text-muted-foreground">
            Pre-built and custom security templates for legacy OS hardening
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {profiles?.map((profile) => {
          const isExpanded = expandedId === profile.id;
          const settings = profile.settings || {};
          const categories = Object.keys(settings);

          return (
            <Card key={profile.id}>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : profile.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {profile.name}
                        {profile.is_system_default && (
                          <Badge variant="secondary" className="text-[10px]">Default</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{profile.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {OS_TARGET_LABELS[profile.os_target] || profile.os_target}
                    </Badge>
                    <div className="flex items-center gap-1">
                      {categories.map((cat) => {
                        const catInfo = CATEGORY_LABELS[cat];
                        return catInfo ? (
                          <Badge key={cat} className={`text-[10px] ${catInfo.color}`}>
                            {catInfo.label}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                    {!profile.is_system_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: profile.id, name: profile.name });
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="border-t pt-4">
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {categories.map((cat) => {
                      const catInfo = CATEGORY_LABELS[cat] || { label: cat, color: "bg-muted text-muted-foreground" };
                      const catSettings = settings[cat] || {};

                      return (
                        <div key={cat} className="space-y-2">
                          <h4 className="text-sm font-medium flex items-center gap-2">
                            <Badge className={`${catInfo.color} text-xs`}>{catInfo.label}</Badge>
                          </h4>
                          <div className="space-y-1">
                            {Object.entries(catSettings).map(([key, val]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                              >
                                <span className="text-muted-foreground">
                                  {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                </span>
                                <span className="font-medium">
                                  {typeof val === "boolean" ? (
                                    <Badge
                                      variant={val ? "default" : "secondary"}
                                      className="text-[10px]"
                                    >
                                      {val ? "Enabled" : "Disabled"}
                                    </Badge>
                                  ) : (
                                    String(val)
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}

        {(!profiles || profiles.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No hardening profiles configured</p>
              <p className="text-sm text-muted-foreground mt-1">
                Enable the Legacy Hardening module in Admin to auto-generate default profiles
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? Endpoints assigned to
              this profile will become unassigned.
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
