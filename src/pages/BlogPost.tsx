import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MarketingShell } from "@/components/layout/MarketingShell";
import { Seo } from "@/components/seo/Seo";
import { articleSchema, breadcrumbSchema } from "@/components/seo/jsonLd";
import { formatPublishedDate, getPost } from "@/lib/blog";
import { Button } from "@/components/ui/button";
import NotFound from "./NotFound";

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPost(slug) : undefined;

  if (!post) return <NotFound />;

  return (
    <MarketingShell>
      <Seo
        title={`${post.title} — Mithras Threat Defence`}
        description={post.description}
        canonical={`/blog/${post.slug}`}
        ogType="article"
        ogImage={post.image}
        publishedAt={post.publishedAt}
        updatedAt={post.updatedAt}
        structuredData={[
          articleSchema({
            title: post.title,
            description: post.description,
            slug: post.slug,
            publishedAt: post.publishedAt,
            updatedAt: post.updatedAt,
            author: post.author,
            image: post.image,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <article className="container mx-auto max-w-3xl px-6 py-16">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          All posts
        </Link>

        <header className="mb-10">
          {post.category && (
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-primary mb-4">
              {post.category}
            </div>
          )}
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
            {post.title}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-6">
            {post.description}
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatPublishedDate(post.publishedAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {post.readingMinutes} min read
            </span>
            {post.author && <span>By {post.author}</span>}
          </div>
        </header>

        <div className="prose prose-invert prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-12 prose-h3:text-xl prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:before:content-[''] prose-code:after:content-[''] max-w-none">
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </div>

        <aside className="mt-16 rounded-2xl border border-border/40 bg-card p-7 text-center">
          <h2 className="text-xl font-bold mb-2">See it on your own endpoints.</h2>
          <p className="text-muted-foreground mb-5 max-w-md mx-auto">
            Mithras is sold through authorised resellers. Get put in touch with one near you
            and see microsegmentation, Defender posture, and a draft monthly report in under
            an hour.
          </p>
          <Button size="lg" asChild>
            <Link to="/contact-sales">Find a reseller</Link>
          </Button>
        </aside>
      </article>
    </MarketingShell>
  );
};

export default BlogPost;
