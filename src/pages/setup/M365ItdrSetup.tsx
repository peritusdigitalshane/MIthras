import ReactMarkdown from "react-markdown";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";

const GUIDE = String.raw`
# Microsoft 365 ITDR — Azure AD app setup

This guide walks the **Mithras platform operator** (super-admin) through registering
the Azure AD application that customers will consent to when connecting their
Microsoft 365 tenant. You do this **once per Mithras platform** — every customer
then uses the same app.

> **Read-only by default.** The default consent gives Mithras read access to
> Entra ID sign-in logs, directory audit logs, mailbox rules, and OAuth grants.
> Remediation actions (disabling a forwarding rule, revoking an OAuth grant) are
> off by default and only granted through a separate, narrower consent flow when
> a customer opts in.

---

## Prerequisites

- An Azure AD tenant you control (this is **your** Mithras tenant, not a
  customer's). A free Microsoft 365 Developer tenant works fine if you don't
  have one yet.
- Global Administrator role in that tenant.
- The redirect URI your callback function will use. For the standard Mithras
  deployment that's:

  \`\`\`
  https://api.mithras.com.au/functions/v1/m365-oauth-callback
  \`\`\`

---

## 1 · Register the app

1. Open <https://entra.microsoft.com> → **Applications → App registrations** →
   **+ New registration**.
2. **Name:** \`Mithras ITDR\` (this is what customer admins see on the consent
   screen, so keep it recognisable).
3. **Supported account types:** _Accounts in any organizational directory
   (Any Microsoft Entra ID tenant — Multitenant)_. This is the critical
   setting — it's what lets customers from different M365 tenants consent.
4. **Redirect URI:** select **Web** and paste the URL from above.
5. Click **Register**.
6. On the Overview page, copy these two values into your notepad:
   - **Application (client) ID**
   - **Directory (tenant) ID** _(this is yours; we use it during refresh.
     The customer's tenant ID is captured automatically when they consent.)_

---

## 2 · API permissions — the read-only set

Still on the app registration page:

1. **API permissions** → **+ Add a permission** → **Microsoft Graph** →
   **Delegated permissions**.
2. Add each of the following, then save:

   | Permission | Why |
   |---|---|
   | \`offline_access\` | Lets Mithras refresh the access token. **Required.** |
   | \`User.Read\` | The signed-in admin's basic profile. |
   | \`AuditLog.Read.All\` | Read Entra ID sign-in + directory audit logs. |
   | \`Directory.Read.All\` | Enumerate users, domains, roles. |
   | \`MailboxSettings.Read\` | Read each user's inbox rules. |
   | \`Application.Read.All\` | List OAuth permission grants. |
   | \`IdentityRiskEvent.Read.All\` | Read Entra ID Protection risk events. |

3. Click **Grant admin consent for [your tenant]** at the top. This consents
   for your own tenant — you'll do this once, customers consent separately
   when they connect.

> **Don't add remediation permissions here.** The remediation scopes
> (\`MailboxSettings.ReadWrite\`, \`Directory.ReadWrite.All\`,
> \`Application.ReadWrite.All\`, \`User.RevokeSessions.All\`) are requested
> dynamically by Mithras during the opt-in remediation flow. You do **not**
> add them as pre-declared permissions, because doing so would force every
> customer to consent to remediation at connection time — defeating the
> opt-in design.

---

## 3 · Create a client secret

1. **Certificates & secrets** → **+ New client secret**.
2. Description: \`Mithras platform secret — rotate yearly\`.
3. Expires: **24 months** (or your org's standard rotation period).
4. Click **Add**.
5. **Copy the secret VALUE column immediately** — Microsoft only shows it once.
   _Do not_ copy the "Secret ID" — that's not what you want.

---

## 4 · Paste into Mithras

1. Sign in to Mithras as a super-admin.
2. Go to **Settings → M365 / Entra ID integration**.
3. Fill in:
   - **Application (client) ID** — from step 1.
   - **Client secret value** — from step 3.
   - **Redirect URI** — exactly as registered:
     \`https://api.mithras.com.au/functions/v1/m365-oauth-callback\`
   - **Authority** — leave as \`https://login.microsoftonline.com\` unless
     you're using a sovereign cloud.
4. Click **Save**.

The card will switch to a green "Configured" indicator. Customers can now
connect their tenant from **Identity (M365) → Connect a Microsoft 365 tenant**.

---

## 5 · Test the connection

Use your own M365 tenant as the first customer:

1. Go to **Identity (M365)**.
2. Click **Connect a Microsoft 365 tenant**.
3. Sign in as a Global Admin of your test tenant.
4. Review the consent screen — it should request exactly the read-only
   permissions from step 2. Click **Accept**.
5. You'll be redirected back to **Identity (M365)** with a "Microsoft 365
   connected" toast.
6. Click **Poll now** on the new tenant row.
7. Within 30 seconds you should see sign-in events appearing in the
   **Risky sign-ins** tab (only if there are risky sign-ins to surface — for
   a fresh test tenant there may be none), and any external mailbox
   forwarding rules in the **External forwarding** tab.

---

## 6 · Set the cron-poller secret

The platform polls every connected tenant every 5 minutes via pg_cron. The cron
job authenticates to the edge function with a shared secret.

1. Pick a random secret: \`openssl rand -base64 32\`.
2. Add it to the edge-functions container env as \`M365_POLL_SECRET\` and
   restart the container.
3. In Mithras, **Settings → Advanced → Platform settings** (or via SQL)
   set \`m365_poller_secret\` to the same value.

The cron job is registered automatically by the
\`20260601100200_m365_itdr_cron.sql\` migration; you only need to wire the
secret.

---

## Rotation

- **Client secret:** rotate every 12-24 months. Create a new secret in
  Azure, paste it into the Mithras settings, then delete the old one in
  Azure. There's no need to re-consent customers.
- **Poller secret:** rotate any time. Update both the env var and the
  platform setting in a single window.

---

## Troubleshooting

- **"invalid_state" on callback** — the state token expired (>15 minutes
  between Connect click and consent). Ask the customer to retry.
- **"m365_integration_not_configured"** — the Azure app credentials in
  Mithras settings are missing. Re-check step 4.
- **"AADSTS50194: Application not configured as a multi-tenant
  application"** — step 1.3 was missed. Edit the app in Azure → Manifest
  → set \`signInAudience\` to \`AzureADMultipleOrgs\`.
- **Customer's consent screen lists more permissions than expected** —
  someone added remediation scopes as pre-declared permissions. Remove
  them per the warning in step 2.
`;

const M365ItdrSetup = () => {
    const { isSuperAdmin, isLoading } = useTenant();
    if (isLoading) return null;
    // Operator-only content: walks through embedding Azure credentials into
    // platform_settings. Non-super-admins should never reach this page.
    if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;
    return (
    <MainLayout>
        <div className="container mx-auto max-w-3xl py-8">
            <div className="flex items-center gap-3 mb-6">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/settings">
                        <ArrowLeft className="h-4 w-4 mr-1.5" />
                        Back to Settings
                    </Link>
                </Button>
            </div>
            <article className="prose prose-invert prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-12 prose-h3:text-xl prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:before:content-[''] prose-code:after:content-[''] prose-table:text-sm max-w-none">
                <ReactMarkdown>{GUIDE}</ReactMarkdown>
            </article>
            <div className="mt-12 rounded-2xl border border-border/40 bg-card p-6 text-center">
                <Settings className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-4">
                    Done with the setup? Head to Settings to paste in the credentials.
                </p>
                <Button asChild>
                    <Link to="/settings">Open Settings</Link>
                </Button>
            </div>
        </div>
    </MainLayout>
    );
};

export default M365ItdrSetup;
