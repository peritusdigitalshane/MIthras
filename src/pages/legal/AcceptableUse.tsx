import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";

const AcceptableUse = () => (
  <MarketingShell>
    <Seo
      title="Acceptable Use Policy — Mithras Threat Defence"
      description="What you can and can't do with Mithras Threat Defence."
      canonical="/acceptable-use"
    />
    <article className="container mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Acceptable Use Policy</h1>

      <p>
        Mithras is a defensive security tool. The simple rule: use it on endpoints you
        are authorised to defend, for the purpose of defending them.
      </p>

      <h2>You may</h2>
      <ul>
        <li>
          Use Mithras to manage endpoints owned by your organisation or, if you are an
          MSP, owned by customers who have engaged you in writing.
        </li>
        <li>
          Generate reports based on the telemetry your endpoints submit.
        </li>
        <li>
          Use Mithras's response actions (isolate, kill process, quarantine file) on
          endpoints you administer.
        </li>
      </ul>

      <h2>You must not</h2>
      <ul>
        <li>
          Use Mithras to monitor endpoints without the legal authority or consent of
          their owner.
        </li>
        <li>
          Attempt to access another customer's data or use the service to gain
          unauthorised access to any system.
        </li>
        <li>
          Reverse-engineer the platform or agent in order to build a competing product,
          except to the extent expressly permitted by law.
        </li>
        <li>
          Use the platform to send unsolicited email, deploy malware, mine
          cryptocurrency, or carry out denial-of-service attacks.
        </li>
        <li>
          Submit knowingly false reports about other parties' systems through any of our
          reporting features.
        </li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        Violations may result in suspension or termination of your account. Serious
        violations involving illegal activity may be reported to law enforcement.
      </p>

      <h2>Reporting abuse</h2>
      <p>
        If you believe Mithras is being used to attack you or your systems, contact
        <a href="mailto:abuse@peritusdigital.com.au"> abuse@peritusdigital.com.au</a>.
      </p>
    </article>
  </MarketingShell>
);

export default AcceptableUse;
