import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Exported so the Landing page can hand them to the FAQPage JSON-LD schema —
// keeps the on-page Q&A and the structured data in lockstep.
export const LANDING_FAQ = [
  {
    question: "Should I run another antivirus alongside Mithras?",
    answer:
      "No — and you shouldn't need to. Microsoft Defender is already a full antivirus and EDR engine, built into every supported Windows. Mithras configures, hardens and monitors that Defender so it actually does the job it was designed for. Running a second antivirus on top of Defender almost always causes conflicts (one quarantines the other, performance tanks, signatures fight). If you already pay for a separate EDR (CrowdStrike, SentinelOne, Huntress), Mithras still adds value via microsegmentation, end-of-life hardening, and M365 posture — but you don't need it as your antivirus layer.",
  },
  {
    question: "Do I need a Microsoft 365 E5 licence to use Mithras?",
    answer:
      "No. Mithras runs on the Defender that's built into Windows 10/11 Pro and Windows Server — no E5, no Defender for Endpoint P2, no Intune subscription required. We meet your business where it is.",
  },
  {
    question: "How does Mithras compare to CrowdStrike, SentinelOne, or Huntress?",
    answer:
      "Those are full EDR products that bring their own antivirus engine. Mithras takes a different angle: it manages the Defender that's already on the box, adds microsegmentation at the Windows Firewall layer, and hardens end-of-life Windows that other EDRs can't even install on. Many MSPs run both — a third-party EDR on flagship endpoints and Mithras for fleet-wide Defender management, legacy boxes, and Microsoft 365 posture.",
  },
  {
    question: "Can Mithras protect Windows 7, 8, or end-of-life Windows 10?",
    answer:
      "Yes — this is one of the core reasons Mithras exists. Our agent runs on Windows 7 SP1 onward, and we ship a hardening profile specifically for end-of-life Windows: tightened firewall rules, microsegmentation, application allow-listing, and DNS filtering. It's not magic, but it materially closes the gap between a legacy box and a modern endpoint.",
  },
  {
    question: "What's microsegmentation and why does it matter for an SMB?",
    answer:
      "Microsegmentation means each computer only accepts traffic from the specific peers and ports it actually needs — so when one box gets compromised, the attacker can't pivot to the rest of the fleet over file-sharing, remote desktop, or WinRM. Mithras builds the rule set automatically by watching live traffic in learn mode, then enforces it with one click. For SMBs this is the single highest-impact ransomware control after good backups.",
  },
  {
    question: "How do I buy Mithras?",
    answer:
      "Mithras is sold exclusively through our authorised channel partner network — distributors who handle billing and resellers (MSPs and IT providers) who handle deployment and day-to-day support. Contact us via the 'Talk to sales' page and we'll connect you with a reseller in your region. If you're an IT provider interested in becoming a reseller or distributor, see the channel program page.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "By default, all customer data is hosted in Australia. Enterprise customers can request a dedicated environment in another region, or a fully on-premise deployment inside your own infrastructure if your compliance posture requires it.",
  },
  {
    question: "Can MSPs white-label the monthly reports?",
    answer:
      "Yes. The MSP plan includes white-label PDF reports — your logo, your colours, your contact details. Each customer organisation gets its own branded monthly security report, delivered automatically.",
  },
  {
    question: "How quickly can I deploy the Mithras agent?",
    answer:
      "About three minutes per machine. Generate an install command in the console, run it (or push via your existing RMM, group policy, or Intune), and the endpoint shows up in the dashboard with full telemetry in under a minute.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="py-24 px-6">
      <div className="container mx-auto max-w-3xl">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
            FAQ
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Honest answers to the questions you're about to ask.
          </h2>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {LANDING_FAQ.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base font-semibold">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
