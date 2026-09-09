import { MainLayout } from "@/components/layout/MainLayout";
import { useTenant } from "@/contexts/TenantContext";
import { MfaSettings } from "@/components/settings/MfaSettings";
import { AlertRecipientsCard } from "@/components/alerts/AlertRecipientsCard";
import { ChangePassword } from "@/components/settings/ChangePassword";
import { OrgManagementCard } from "@/components/settings/OrgManagementCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Settings as SettingsIcon, ShieldAlert, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Settings = () => {
  const { isSuperAdmin } = useTenant();

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
              Your account and your organisation.
            </p>
          </div>
        </div>

        <div className="grid gap-6">
          {/* Account security */}
          <MfaSettings />
          <ChangePassword />

          {/* Organisation — rename + leave */}
          <OrgManagementCard />

          {/* Alert recipients — who gets emailed when threats fire */}
          <AlertRecipientsCard />

          {/* Super-admin platform settings moved off this page. Surface the
              link so super-admins know where to go; everyone else never sees
              this notice. */}
          {isSuperAdmin && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Platform settings live separately</AlertTitle>
              <AlertDescription className="text-sm space-y-2">
                <p>
                  SMTP, Stripe, OpenAI, the Microsoft 365 Azure app, VirusTotal, and analytics are super-admin-only and now live under{" "}
                  <Link to="/admin/settings" className="underline font-medium">Admin → Platform settings</Link>. This keeps the Settings page above identical for every operator regardless of role.
                </p>
                <Link to="/admin/settings" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Open platform settings <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Settings;
