import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { AISocSection } from "@/components/landing/AISocSection";
import { StatsSection } from "@/components/landing/StatsSection";
import { FeaturesOverview } from "@/components/landing/FeaturesOverview";
import { FeatureShowcase } from "@/components/landing/FeatureShowcase";
import { ProtectionSection } from "@/components/landing/ProtectionSection";
import { MSPSection } from "@/components/landing/MSPSection";
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
        <AISocSection />
        <StatsSection />
        <FeaturesOverview />
        <FeatureShowcase />
        <ProtectionSection />
        <MSPSection />
        <PricingSection />
        <FaqSection />
        <CTASection />
        <Footer />
      </div>
    </>
  );
};

export default Landing;
