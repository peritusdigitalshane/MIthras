import { Helmet } from "react-helmet-async";

const SITE_URL = "https://www.mithras.com.au";
const DEFAULT_OG_IMAGE = `${SITE_URL}/mithras-icon-512.png`;

interface SeoProps {
  title: string;
  description: string;
  canonical?: string;
  ogType?: "website" | "article";
  ogImage?: string;
  publishedAt?: string;
  updatedAt?: string;
  noindex?: boolean;
  structuredData?: object | object[];
}

/**
 * Per-route SEO. Sets the page title, meta description, canonical URL,
 * OpenGraph + Twitter cards, and optional JSON-LD structured data. Marketing
 * routes should render exactly one <Seo> at the top of the page.
 *
 * canonical / ogImage default to absolute URLs derived from the canonical path.
 */
export function Seo({
  title,
  description,
  canonical,
  ogType = "website",
  ogImage,
  publishedAt,
  updatedAt,
  noindex,
  structuredData,
}: SeoProps) {
  const canonicalUrl = canonical
    ? canonical.startsWith("http")
      ? canonical
      : `${SITE_URL}${canonical.startsWith("/") ? canonical : `/${canonical}`}`
    : SITE_URL;
  const image = ogImage ?? DEFAULT_OG_IMAGE;
  const structuredArr = Array.isArray(structuredData)
    ? structuredData
    : structuredData
      ? [structuredData]
      : [];

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="512" />
      <meta property="og:image:height" content="512" />
      <meta property="og:site_name" content="Mithras Threat Defence" />
      <meta property="og:locale" content="en_AU" />

      {publishedAt && <meta property="article:published_time" content={publishedAt} />}
      {updatedAt && <meta property="article:modified_time" content={updatedAt} />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:site" content="@MithrasSecure" />

      {structuredArr.map((data, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}

export { SITE_URL };
