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
    question: "Does Mithras protect against phishing emails?",
    answer:
      "Yes. The platform connects to Microsoft 365 via Graph API and classifies every inbound message with AI every two minutes — phishing, BEC, malware, spam, suspicious, or legitimate. Confirmed phishing can be quarantined per-row or in bulk during a campaign, and you stop repeat campaigns at the source with per-tenant block rules on the sender domain. Recipients of confirmed phishing get a Mithras-branded warning with a self-service release link in case the model got it wrong. It's bundled in the $11/seat subscription — no separate email security SKU.",
  },
  {
    question: "Should I run another antivirus alongside Mithras?",
    answer:
      "No. Microsoft Defender is already a full antivirus and EDR engine and it's already on the box. Mithras configures, hardens and watches it. Stacking a second AV on top usually ends badly. Performance drops, the two engines quarantine each other, signature updates fight for the same files. If you already pay for CrowdStrike, SentinelOne or Huntress, keep them on your crown jewels and let Mithras run the rest of the fleet plus the bits those products don't cover. Microsegmentation, end-of-life Windows, M365 identity.",
  },
  {
    question: "Do I need a Microsoft 365 E5 licence to use Mithras?",
    answer:
      "No. Mithras runs on the Defender that ships with Windows 10/11 Pro and Windows Server. No E5, no Defender for Endpoint P2, no Intune. We pull what we need out of the agent we install and the policies we push from the console. Your existing M365 Business Standard works fine.",
  },
  {
    question: "How does Mithras compare to CrowdStrike, SentinelOne or Huntress?",
    answer:
      "Those products are full EDRs that ship their own antivirus engine. We take a different angle. We manage the Defender that's already on the machine, add microsegmentation at the Windows Firewall layer, and harden end-of-life Windows that the others won't even install on. A lot of MSPs run both. Big-name EDR on the crown jewels. Mithras across the rest of the fleet, the legacy boxes, and the M365 tenants.",
  },
  {
    question: "Can Mithras protect Windows 7, 8 or end-of-life Windows 10?",
    answer:
      "Yes, and this is half the reason we built it. The agent runs on Windows 7 SP1 onward. We ship a hardening profile specifically for the boxes Microsoft has walked away from. Tighter firewall rules, microsegmentation, application allow-listing, DNS filtering. We're not pretending an end-of-life box is the same risk as a Windows 11 machine. We are closing the gap by a long way.",
  },
  {
    question: "What is microsegmentation and why does it matter for an SMB?",
    answer:
      "Plain English: each computer only accepts traffic from the peers and ports it actually needs. When one box gets popped, the attacker can't pivot across the network over SMB, RDP or WinRM. Mithras builds the rule set by watching traffic in audit mode for a few days, then you enforce it with one click. After backups, this is the single biggest ransomware control an SMB can deploy.",
  },
  {
    question: "How do I actually buy it?",
    answer:
      "Through a partner. Distributors handle billing. Resellers (your MSP or local IT shop) handle deployment and day-to-day support. Tell us roughly where you are and how many endpoints you have on the talk-to-sales page, and we'll match you to a reseller in your region. If you run the IT shop, the channel program page is the entry point.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Australia, by default. Enterprise customers can request a dedicated environment in another region. We will also do an on-premise deployment inside your own infrastructure if your compliance posture demands it.",
  },
  {
    question: "Do my customers see Mithras branding?",
    answer:
      "Monthly reports go out under the Mithras name. Partners receive a co-branded PDF that adds your business details to the cover page so customers know who they're working with. Full white-label is on the roadmap for partners with the volume to justify it — talk to us if that's you.",
  },
  {
    question: "How long does it take to deploy the agent?",
    answer:
      "Three minutes per machine if you're doing it interactively. A lot less if you push the MSI through your RMM or group policy. The endpoint appears in the console within sixty seconds of the install completing.",
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
            The questions we get asked first.
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
