import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { AISocTeaser } from "@/components/landing/AISocTeaser";
import { PlatformShowcase } from "@/components/landing/PlatformShowcase";
import { PlatformHighlights } from "@/components/landing/PlatformHighlights";
import { ThreatIntelStrip } from "@/components/landing/ThreatIntelStrip";
import { MSPTeaser } from "@/components/landing/MSPTeaser";
import { PricingSection } from "@/components/landing/PricingSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { CTASection, Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";
import {
  faqSchema,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/components/seo/jsonLd";
import { LANDING_FAQ } from "@/components/landing/FaqSection";

/**
 * Homepage. After the Jun 12 IA refactor, dense capability content lives on
 * dedicated routes (/ai-soc, /platform, /for-msps, /eol-windows). The home
 * page is now a short marketing surface: hero → AI SOC teaser → 4 platform
 * highlights linking to the deep pages → MSP teaser → pricing → FAQ → CTA.
 */
const Landing = () => {
  return (
    <>
      <Seo
        title="Mithras Threat Defence | AI SOC + M365 email security for Australian MSPs"
        description="Five purpose-built AI agents run your SOC round the clock and triage every Microsoft 365 inbox for phishing, BEC and malware. We harden Microsoft Defender across your fleet, microsegment Windows endpoints, and cover the end-of-life machines other EDRs refuse to install on. $11 a seat. Sold through partners."
        canonical="/"
        keywords="AI SOC, endpoint security Australia, Microsoft Defender management, MSP security platform, M365 email security, phishing protection, BEC protection, AI phishing detection, microsegmentation Windows, EDR for SMB, end of life Windows hardening, Mithras Threat Defence"
        structuredData={[
          organizationSchema(),
          websiteSchema(),
          softwareApplicationSchema(),
          faqSchema(LANDING_FAQ),
        ]}
      />
      <div className="min-h-screen bg-background">
        <LandingNav />
        <HeroSection />
        <AISocTeaser />
        <PlatformShowcase />
        <ThreatIntelStrip />
        <PlatformHighlights />
        <MSPTeaser />
        <PricingSection />
        <FaqSection />
        <CTASection />
        <Footer />
      </div>
    </>
  );
};

export default Landing;
