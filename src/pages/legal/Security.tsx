import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";

const Security = () => (
  <MarketingShell>
    <Seo
      title="Security at Mithras — controls, posture, and disclosure"
      description="How Mithras secures customer data and infrastructure: tenancy model, encryption, access controls, vulnerability disclosure, and current compliance posture."
      canonical="/security"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Security at Mithras</h1>
      <p>
        We sell endpoint security. We owe you honesty about how we protect the data you
        send us. This page is updated whenever our posture changes.
      </p>

      <h2>Tenancy model</h2>
      <p>
        Mithras is multi-tenant. Customer data is segregated by row-level security
        policies in PostgreSQL — every query an operator makes is filtered by their
        organisation membership at the database level, not just at the application layer.
        The schema and helper functions used to enforce this are open to customer audit
        on request.
      </p>

      <h2>Encryption</h2>
      <ul>
        <li>TLS 1.2+ in transit for all customer-facing endpoints.</li>
        <li>Encryption at rest on managed database storage.</li>
        <li>
          Agent-to-platform traffic is HTTPS with HMAC request signing for the modern
          agent runtime.
        </li>
      </ul>

      <h2>Access controls</h2>
      <ul>
        <li>Strong password requirements on the platform; SSO available on Enterprise.</li>
        <li>
          Internal access to production infrastructure is limited to a small number of
          named engineers, authenticated via SSH key + bastion.
        </li>
        <li>Audit logs are immutable and retained for 12 months.</li>
      </ul>

      <h2>Current compliance posture</h2>
      <p>
        We are not currently SOC 2 or ISO 27001 certified. We're early enough as a
        product that paying for an audit before iterating the controls would be
        premature. We commit to publishing a SOC 2 Type I report by the end of FY26 if
        we hit our planned customer milestones; until then we will continue to disclose
        controls openly and respond to customer security questionnaires.
      </p>

      <h2>Backups and continuity</h2>
      <p>
        The database is backed up daily, with point-in-time recovery available for
        rollback. Backups are encrypted and retained for 30 days. We test restoration
        from backup quarterly.
      </p>

      <h2>Responsible disclosure</h2>
      <p>
        If you've found a security issue, please email
        <a href="mailto:security@peritusdigital.com.au"> security@peritusdigital.com.au</a>.
        We acknowledge reports within 2 business days and will work with you on a
        coordinated disclosure timeline. We do not currently pay bounties but we will
        publicly credit researchers who responsibly report issues.
      </p>

      <h2>Sub-processors</h2>
      <ul>
        <li>Supabase (database, auth) — operated by Supabase Inc.</li>
        <li>Vultr (compute) — operated by The Constant Company LLC.</li>
        <li>Stripe (payments) — operated by Stripe Inc.</li>
        <li>Outbound SMTP — operated by our transactional email provider.</li>
      </ul>

      <h2>Updates</h2>
      <p>
        Material changes to our security posture will be reflected on this page and on
        our <a href="/status">status page</a>.
      </p>
    </article>
  </MarketingShell>
);

export default Security;
