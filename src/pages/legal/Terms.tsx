import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";

const EFFECTIVE_DATE = "1 June 2026";

const Terms = () => (
  <MarketingShell>
    <Seo
      title="Terms of Service — Mithras Threat Defence"
      description="Terms of service for Mithras Threat Defence operated by Peritus Digital Pty Ltd."
      canonical="/terms"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <p>
        These Terms govern your access to and use of Mithras Threat Defence, operated by
        Peritus Digital Pty Ltd ("Peritus", "we"). By creating an account you agree to
        these Terms.
      </p>

      <h2>1. Your account</h2>
      <p>
        You must provide accurate signup information and keep your sign-in credentials
        confidential. You are responsible for activity under your account, including any
        endpoints you enrol.
      </p>

      <h2>2. Onboarding</h2>
      <p>
        Mithras is sold through authorised channel partners. Each customer account is
        provisioned by a distributor or reseller, who issues an enrolment code at the
        start of the engagement. There is no public self-service trial; speak to a
        reseller in your region to evaluate the platform.
      </p>

      <h2>3. Billing</h2>
      <p>
        Paid plans are billed annually in advance, in Australian dollars, and are GST-
        inclusive for Australian customers. Endpoint counts are checked at the end of
        each calendar month; if you exceed your committed count we will invoice the
        overage at your plan rate.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree to use Mithras in accordance with our
        <a href="/acceptable-use"> Acceptable Use Policy</a>. Violations may result in
        suspension or termination of your account.
      </p>

      <h2>5. Customer data</h2>
      <p>
        You retain ownership of all data you submit to Mithras. We will only access your
        data to deliver and improve the service, respond to support requests you raise,
        or comply with legal obligations. Our handling of personal information is
        governed by our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>6. Service availability</h2>
      <p>
        We strive for high availability. Enterprise plans include a 99.9% uptime SLA;
        other plans are provided on a commercially reasonable best-effort basis. Planned
        maintenance is announced on the <a href="/status">status page</a>.
      </p>

      <h2>7. Warranties and liability</h2>
      <p>
        Mithras is a security control, not a guarantee of security outcomes. To the
        extent permitted by law we provide the service "as is" and exclude all implied
        warranties. Nothing in these Terms excludes any rights you have under the
        Australian Consumer Law that cannot be excluded.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may cancel your account at any time from the settings page. We may suspend
        or terminate your account for non-payment or material breach of these Terms,
        after giving you a reasonable opportunity to remedy.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of Queensland, Australia. Disputes are
        subject to the exclusive jurisdiction of the courts of Queensland.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these Terms; material changes will be emailed to account owners
        and published here at least 14 days before they take effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions: <a href="mailto:legal@peritusdigital.com.au">legal@peritusdigital.com.au</a>.
      </p>
    </article>
  </MarketingShell>
);

export default Terms;
