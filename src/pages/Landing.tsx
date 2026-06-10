import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
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
        title="Mithras Threat Defence — Endpoint security for MSPs, built in Australia"
        description="Multi-tenant endpoint security platform for MSPs and SMBs. Centrally harden Microsoft Defender, microsegment Windows endpoints, and protect end-of-life Windows boxes — no E5 required. Sold through authorised channel partners."
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
