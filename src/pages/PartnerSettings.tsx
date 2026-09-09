import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PortalHero } from "@/components/portal/PortalHero";
import { Settings, Clock, ShieldCheck, Globe } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useTimezone, TIMEZONE_OPTIONS } from "@/hooks/useTimezone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function PartnerSettings() {
  const { currentOrganization, isOrgAdmin } = useTenant();
  const { timezone, orgTimezone, userOverride, setTimezone } = useTimezone();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pendingOrgTz, setPendingOrgTz] = useState<string>(orgTimezone ?? "Australia/Sydney");
  const [savingOrg, setSavingOrg] = useState(false);
  const [pendingUserTz, setPendingUserTz] = useState<string>(userOverride ?? "");

  // Sync local select state whenever the org or override changes.
  useEffect(() => { setPendingOrgTz(orgTimezone ?? "Australia/Sydney"); }, [orgTimezone]);
  useEffect(() => { setPendingUserTz(userOverride ?? ""); }, [userOverride]);

  async function saveOrgTimezone() {
    if (!currentOrganization?.id) return;
    setSavingOrg(true);
    try {
      const { error } = await supabase.rpc("set_organization_timezone" as any, {
        _org_id: currentOrganization.id,
        _timezone: pendingOrgTz,
      });
      if (error) throw error;
      toast({ title: "Organisation timezone updated", description: `New default: ${pendingOrgTz}.` });
      // Refresh anything that cached the org row, including TenantContext's
      // initial load on next mount.
      qc.invalidateQueries();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const friendly = msg.includes("forbidden") ? "Only org admins, partner admins, or super-admins can change this."
        : msg.includes("invalid_timezone") ? `That isn't a recognised IANA timezone: ${pendingOrgTz}.`
        : msg || "Couldn't update the organisation timezone.";
      toast({ title: "Couldn't save", description: friendly, variant: "destructive" });
    } finally {
      setSavingOrg(false);
    }
  }

  function applyUserOverride() {
    setTimezone(pendingUserTz === "" ? null : pendingUserTz);
    toast({
      title: pendingUserTz === "" ? "Personal override cleared" : "Personal override set",
      description: pendingUserTz === ""
        ? `Falling back to ${orgTimezone ?? "Australia/Sydney"} (organisation default).`
        : `Dates will now display in ${pendingUserTz} for this device only.`,
    });
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-4xl mx-auto">
        <PortalHero
          eyebrow="Partner portal"
          eyebrowIcon={<Settings className="h-3.5 w-3.5" />}
          title="Settings"
          subtitle="Defaults that apply to everyone in your organisation. Each user can override these for their own login if they need to."
          accent="indigo"
        />

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Organisation timezone
                </CardTitle>
                <CardDescription>
                  Every console date and time defaults to this zone for everyone in <strong>{currentOrganization?.name ?? "your organisation"}</strong>. Choose the zone your team operates in.
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                Current: {orgTimezone ?? "Australia/Sydney"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-tz">Organisation default</Label>
              <Select value={pendingOrgTz} onValueChange={setPendingOrgTz} disabled={!isOrgAdmin}>
                <SelectTrigger id="org-tz" className="max-w-md"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isOrgAdmin && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Read-only</AlertTitle>
                <AlertDescription>
                  Only an organisation admin can change the default. Ask the owner of <strong>{currentOrganization?.name}</strong> to update it.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                onClick={saveOrgTimezone}
                disabled={!isOrgAdmin || savingOrg || pendingOrgTz === (orgTimezone ?? "Australia/Sydney")}
              >
                {savingOrg ? "Saving…" : "Save organisation timezone"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  Your personal override
                </CardTitle>
                <CardDescription>
                  Pin a different zone for your own login on this device. Useful for travel or staff in other regions. Leave empty to use the organisation default.
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                Currently rendering in {timezone}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-tz">Personal override</Label>
              <Select value={pendingUserTz || "__none"} onValueChange={(v) => setPendingUserTz(v === "__none" ? "" : v)}>
                <SelectTrigger id="user-tz" className="max-w-md"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Use organisation default ({orgTimezone ?? "Australia/Sydney"})</SelectItem>
                  {TIMEZONE_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={applyUserOverride}>
                {pendingUserTz === "" ? "Clear my override" : "Apply override"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
