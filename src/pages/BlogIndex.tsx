import { Link } from "react-router-dom";
import { ArrowRight, Clock, Calendar } from "lucide-react";
import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";
import { breadcrumbSchema } from "@/components/seo/jsonLd";
import { formatPublishedDate, listPosts } from "@/lib/blog";

const BlogIndex = () => {
  const posts = listPosts();
  return (
    <MarketingShell>
      <Seo
        title="Blog — Mithras Threat Defence"
        description="Endpoint security, Microsoft Defender management, microsegmentation, and MSP playbooks — from the team building Mithras Threat Defence."
        canonical="/blog"
        structuredData={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ])}
      />
      <section className="container mx-auto max-w-4xl px-6 py-16">
        <div className="mb-12">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-4">
            Blog
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Field notes from the endpoint frontline.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Plain-English writing on Microsoft Defender, microsegmentation, end-of-life
            Windows, and the practical realities of running endpoint security at MSP
            scale.
          </p>
        </div>

        <div className="space-y-8">
          {posts.length === 0 && (
            <p className="text-muted-foreground">No posts yet — first one is in the oven.</p>
          )}
          {posts.map((p) => (
            <article
              key={p.slug}
              className="rounded-2xl border border-border/40 bg-card p-7 hover:border-primary/40 transition-colors"
            >
              {p.category && (
                <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-primary mb-3">
                  {p.category}
                </div>
              )}
              <h2 className="text-2xl font-bold mb-3 leading-tight">
                <Link to={`/blog/${p.slug}`} className="hover:text-primary transition-colors">
                  {p.title}
                </Link>
              </h2>
              <p className="text-muted-foreground mb-5 leading-relaxed">{p.description}</p>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatPublishedDate(p.publishedAt)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {p.readingMinutes} min read
                  </span>
                </div>
                <Link
                  to={`/blog/${p.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:gap-2.5 transition-all"
                >
                  Read post
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
};

export default BlogIndex;
