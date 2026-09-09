import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";

const EFFECTIVE_DATE = "1 June 2026";

const Terms = () => (
  <MarketingShell>
    <Seo
      title="Terms of Service — Mithras Threat Defence"
      description="Terms of service for Mithras Threat Defence."
      canonical="/terms"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      {/*
        Legal entity placeholder. Replace "Mithras" below with the registered
        operator's full Pty Ltd / ABN name once the trading entity is
        finalised, e.g. "Mithras Pty Ltd (ABN xx xxx xxx xxx)". A signed
        legal review should sign off this text before launch.
      */}
      <p>
        These Terms govern your access to and use of Mithras Threat Defence
        (the &quot;Service&quot;, &quot;we&quot;, &quot;our&quot;). By creating an account you agree to these
        Terms.
      </p>

      <h2>1. Your account</h2>
      <p>
        You must provide accurate signup information and keep your sign-in credentials
        confidential. You are responsible for activity under your account, including any
        endpoints you enrol.
      </p>

      <h2>2. Onboarding</h2>
      <p>
        Business plans are sold through authorised channel partners. Each business
        account is provisioned by a distributor or reseller, who issues an enrolment
        code at the start of the engagement. There is no public self-service trial of
        the business plan; speak to a reseller in your region to evaluate it. Home
        users can subscribe directly to the personal plan at <a href="/personal">/personal</a>.
      </p>

      <h2>3. Billing</h2>
      <p>
        Business plans are billed monthly or annually in advance via the channel partner
        invoice, in Australian dollars, and are GST-inclusive for Australian customers.
        Endpoint counts are checked at the end of each calendar month; if you exceed
        your committed count we will invoice the overage at your plan rate. The personal
        plan is billed monthly via Stripe direct.
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
        We strive for high availability. All plans are currently provided on a
        commercially reasonable best-effort basis; we do not yet offer a contractual
        uptime SLA. Planned maintenance is announced on the <a href="/status">status page</a>.
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
        Questions: <a href="mailto:legal@mithras.com.au">legal@mithras.com.au</a>.
      </p>
    </article>
  </MarketingShell>
);

export default Terms;
