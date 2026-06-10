import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";

const EFFECTIVE_DATE = "1 June 2026";

const Privacy = () => (
  <MarketingShell>
    <Seo
      title="Privacy Policy — Mithras Threat Defence"
      description="How Peritus Digital collects, uses, and protects customer data when you use Mithras Threat Defence."
      canonical="/privacy"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <p>
        This Privacy Policy explains how Peritus Digital Pty Ltd (ACN forthcoming),
        operator of Mithras Threat Defence ("Mithras", "we", "us"), handles personal
        information collected through the Mithras platform.
      </p>

      <h2>1. Information we collect</h2>
      <p>When you create a Mithras account we collect:</p>
      <ul>
        <li>Account identifiers (email, organisation name, role).</li>
        <li>
          Billing information (handled by our payment processor — we do not store full
          card details).
        </li>
        <li>
          Telemetry your endpoints send via the Mithras agent: Microsoft Defender
          posture, threat detections, Windows Event Log entries, firewall traffic
          summaries, software inventory, and configuration state.
        </li>
        <li>
          Operator activity inside the console (sign-ins, policy changes,
          administrative actions).
        </li>
      </ul>

      <h2>2. Why we collect it</h2>
      <p>
        We collect this data to deliver the service you signed up for: showing you
        endpoint posture, alerting on threats, generating monthly reports for your
        customers, and improving the product. We do not sell personal information to
        third parties. We do not use customer telemetry to train external AI models.
      </p>

      <h2>3. Where data is stored</h2>
      <p>
        By default, all customer data is stored on infrastructure located in Australia.
        Enterprise customers may request data residency in another region or an
        on-premise deployment in their own infrastructure.
      </p>

      <h2>4. Security</h2>
      <p>
        We protect data with industry-standard controls including encryption in transit
        (TLS 1.2+) and at rest, multi-tenant row-level security in the database, and
        principle-of-least-privilege access for operators. We disclose our current
        security posture honestly at <a href="/security">/security</a>.
      </p>

      <h2>5. Third parties</h2>
      <p>
        Mithras runs on Supabase (database and authentication) and Vultr (compute), both
        operated under their own privacy policies. Payment processing is handled by
        Stripe. Email delivery is handled by our outbound SMTP provider. We share
        personal information with these providers only as required to deliver the
        service.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You can request access to, correction of, or deletion of personal information we
        hold about you by emailing
        <a href="mailto:privacy@peritusdigital.com.au"> privacy@peritusdigital.com.au</a>.
        Australian users have the rights set out in the Privacy Act 1988 (Cth) and the
        Australian Privacy Principles.
      </p>

      <h2>7. Changes to this policy</h2>
      <p>
        We will publish material changes to this policy on this page and email account
        owners at least 14 days before they take effect.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions or complaints: <a href="mailto:privacy@peritusdigital.com.au">privacy@peritusdigital.com.au</a>.
      </p>
    </article>
  </MarketingShell>
);

export default Privacy;
