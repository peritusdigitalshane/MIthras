import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { AISocTeaser } from "@/components/landing/AISocTeaser";
import { PlatformHighlights } from "@/components/landing/PlatformHighlights";
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
        title="Mithras Threat Defence — 24/7 AI SOC for MSPs, built in Australia"
        description="An AI-first SOC for MSPs. Five specialised AI agents triage every alert, cross-check each other, and respond in seconds — 24/7/365. Centrally harden Microsoft Defender, microsegment Windows endpoints, and protect end-of-life Windows boxes — no E5 required."
        canonical="/"
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
