import { SITE_URL } from "./Seo";

const ORG_NAME = "Mithras Threat Defence";
const ORG_LEGAL_NAME = "Peritus Digital Pty Ltd";
const ORG_EMAIL = "hello@peritusdigital.com.au";
const ORG_ADDRESS_LOCALITY = "Brisbane";
const ORG_ADDRESS_REGION = "QLD";
const ORG_ADDRESS_COUNTRY = "AU";
const ORG_LOGO = `${SITE_URL}/mithras-icon-512.png`;

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: ORG_NAME,
    legalName: ORG_LEGAL_NAME,
    url: SITE_URL,
    logo: ORG_LOGO,
    email: ORG_EMAIL,
    address: {
      "@type": "PostalAddress",
      addressLocality: ORG_ADDRESS_LOCALITY,
      addressRegion: ORG_ADDRESS_REGION,
      addressCountry: ORG_ADDRESS_COUNTRY,
    },
    sameAs: ["https://peritusdigital.com.au"],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: ORG_NAME,
    url: SITE_URL,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en-AU",
  };
}

export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: ORG_NAME,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Windows, Linux",
    description:
      "Multi-tenant endpoint security platform for MSPs and SMBs. Centrally hardens, monitors, and remediates Microsoft Defender on Windows endpoints with microsegmentation, EOL OS hardening, and group policy management.",
    url: SITE_URL,
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: [
      {
        "@type": "Offer",
        name: "Starter",
        price: "4",
        priceCurrency: "AUD",
        description: "Per endpoint, per month. Up to 50 endpoints.",
      },
      {
        "@type": "Offer",
        name: "MSP",
        price: "3",
        priceCurrency: "AUD",
        description: "Per endpoint, per month. Unlimited customer organisations.",
      },
    ],
  };
}

interface FaqEntry {
  question: string;
  answer: string;
}

export function faqSchema(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  };
}

interface BreadcrumbEntry {
  name: string;
  path: string;
}

export function breadcrumbSchema(entries: BreadcrumbEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: e.name,
      item: `${SITE_URL}${e.path}`,
    })),
  };
}

interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  publishedAt: string;
  updatedAt?: string;
  author?: string;
  image?: string;
}

export function articleSchema(input: ArticleSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    image: input.image ? [input.image] : [ORG_LOGO],
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: {
      "@type": input.author ? "Person" : "Organization",
      name: input.author ?? ORG_NAME,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${input.slug}`,
    },
  };
}
