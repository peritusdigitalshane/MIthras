import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenant } from "@/contexts/TenantContext";
import { PlatformSettingsSection } from "@/components/admin/PlatformSettingsSection";
import { VirusTotalSettingsCard } from "@/components/admin/VirusTotalSettingsCard";
import { M365IntegrationSettingsCard } from "@/components/admin/M365IntegrationSettingsCard";
import { AnalyticsSettingsCard } from "@/components/admin/AnalyticsSettingsCard";
import { MfaSettings } from "@/components/settings/MfaSettings";
import { AlertRecipientsCard } from "@/components/alerts/AlertRecipientsCard";
import { ChangePassword } from "@/components/settings/ChangePassword";
import { SmtpSettingsCard } from "@/components/admin/SmtpSettingsCard";
import { StripeSettingsCard } from "@/components/admin/StripeSettingsCard";
import { OrgManagementCard } from "@/components/settings/OrgManagementCard";
import { Building2, Settings as SettingsIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const Settings = () => {
  const { currentOrganization, isSuperAdmin } = useTenant();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <SettingsIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Manage your account and organization settings
            </p>
          </div>
        </div>

        <div className="grid gap-6">
          {/* Account Security Section */}
          <MfaSettings />
          <ChangePassword />

          {/* Organisation — rename + leave */}
          <OrgManagementCard />

          {/* Alert recipients — who gets emailed when threats fire */}
          <AlertRecipientsCard />

          {/* Super Admin Only Settings */}
          {isSuperAdmin && (
            <>
              <SmtpSettingsCard />
              <StripeSettingsCard />
              <PlatformSettingsSection />
              <VirusTotalSettingsCard />
              <M365IntegrationSettingsCard />
              <AnalyticsSettingsCard />
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Settings;
