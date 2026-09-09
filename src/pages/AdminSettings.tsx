import { Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useTenant } from "@/contexts/TenantContext";
import { PlatformSettingsSection } from "@/components/admin/PlatformSettingsSection";
import { VirusTotalSettingsCard } from "@/components/admin/VirusTotalSettingsCard";
import { M365IntegrationSettingsCard } from "@/components/admin/M365IntegrationSettingsCard";
import { AnalyticsSettingsCard } from "@/components/admin/AnalyticsSettingsCard";
import { SmtpSettingsCard } from "@/components/admin/SmtpSettingsCard";
import { StripeSettingsCard } from "@/components/admin/StripeSettingsCard";
import { PortalHero } from "@/components/portal/PortalHero";
import { ShieldAlert, Lock } from "lucide-react";

// Platform-wide super-admin settings. These configure shared infrastructure
// (SMTP relay, Stripe, OpenAI, Azure AD app, VirusTotal, analytics) that
// applies across every tenant — not per-org operational settings. Lives at
// /admin/settings so it stays out of the partner-portal Settings surface
// and makes the super-admin/partner split visually obvious.

export default function AdminSettings() {
  const { isSuperAdmin, isLoading } = useTenant();

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </MainLayout>
    );
  }

  if (!isSuperAdmin) {
    // Anyone non-super-admin who lands here gets bounced. Belt + braces over
    // the sidebar gate.
    return <Navigate to="/settings" replace />;
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <PortalHero
          eyebrow="Super admin"
          eyebrowIcon={<ShieldAlert className="h-3.5 w-3.5" />}
          title="Platform settings"
          subtitle="Shared infrastructure that applies to every tenant — SMTP relay, Stripe, OpenAI, the Microsoft 365 Azure app registration, VirusTotal, and analytics. Visible only to Mithras super-admins; not part of the partner-portal Settings surface."
          accent="rose"
          status={{ label: "Super-admin only", tone: "warn" }}
        />

        <SectionHeader title="Communications" body="Outbound mail relay used for alerts, customer reports, password resets, and the email-security warning notifications." />
        <SmtpSettingsCard />

        <SectionHeader title="Billing" body="Stripe configuration for the home-user subscription path. Channel customers are billed by their partner, not Stripe." />
        <StripeSettingsCard />

        <SectionHeader title="AI providers" body="OpenAI API key and active model choice. Powers the AI SOC agents, the email-security classifier, and the security advisor recommendations." />
        <PlatformSettingsSection />

        <SectionHeader title="Microsoft 365 integration" body="Azure AD app registration credentials. Every customer-tenant M365 connection routes through this single app, so it must be a multitenant registration." />
        <M365IntegrationSettingsCard />

        <SectionHeader title="Threat intelligence enrichment" body="Optional VirusTotal API key for hash + URL enrichment during incident triage." />
        <VirusTotalSettingsCard />

        <SectionHeader title="Analytics" body="Public-site analytics provider and tracking IDs. Affects the marketing pages, not the protected console." />
        <AnalyticsSettingsCard />

        <div className="text-xs text-muted-foreground flex items-center gap-2 pt-4 border-t">
          <Lock className="h-3.5 w-3.5" />
          Every section above writes to <code className="font-mono text-[11px]">platform_settings</code>. Changes apply immediately to every tenant.
        </div>
      </div>
    </MainLayout>
  );
}

function SectionHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
    </div>
  );
}
