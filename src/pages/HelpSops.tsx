import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen, Search, Clock, ChevronRight, ArrowLeft, Tag, Users,
  ShieldCheck, Briefcase, Building2, Home, Bot,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AUDIENCE_LABELS, AUDIENCE_DESCRIPTIONS, audienceCounts, listSops, searchSops, getSop,
  type SopAudience,
} from "@/lib/sops";

const AUDIENCE_ORDER: SopAudience[] = [
  "peritus_super_admin",
  "soc_operator",
  "distributor",
  "partner",
  "customer_admin",
  "customer_member",
  "home_user",
];

const AUDIENCE_ICONS: Record<SopAudience, React.ComponentType<{ className?: string }>> = {
  peritus_super_admin: ShieldCheck,
  soc_operator:        Bot,
  distributor:         Building2,
  partner:             Briefcase,
  customer_admin:      Users,
  customer_member:     Users,
  home_user:           Home,
};

/**
 * /help/sops — Standard Operating Procedures index + detail.
 *
 * Routes:
 *   /help/sops                  → audience picker + searchable list
 *   /help/sops/:audience        → all SOPs for one audience
 *   /help/sops/:audience/:slug  → render a single SOP
 *
 * Content lives as .md files under src/content/sops/<audience>/<slug>.md
 * and is inlined at build time by Vite (see src/lib/sops.ts).
 */
export default function HelpSops() {
  const { audience: routeAudience, slug } = useParams<{ audience?: SopAudience; slug?: string }>();

  if (routeAudience && slug) {
    return <SopDetail audience={routeAudience} slug={slug} />;
  }
  if (routeAudience) {
    return <AudienceIndex audience={routeAudience} />;
  }
  return <CatalogueIndex />;
}

// ---------------------------------------------------------------------------
// Top-level — pick an audience, or search across all
// ---------------------------------------------------------------------------

function CatalogueIndex() {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => audienceCounts(), []);
  const searchResults = useMemo(() => (query.trim() ? searchSops(query) : []), [query]);

  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Standard Operating Procedures
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step-by-step procedures for the things you do most. Pick your role to see what's relevant.
          </p>
        </div>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all SOPs…"
            className="pl-9"
          />
        </div>

        {query.trim() ? (
          <div className="space-y-2">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-medium">
              {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
            </h2>
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SOPs matched &quot;{query}&quot;. Try a different keyword.</p>
            ) : (
              <ul className="space-y-1">
                {searchResults.map((s) => (
                  <li key={`${s.audience}-${s.slug}`}>
                    <Link to={`/help/sops/${s.audience}/${s.slug}`} className="block rounded-lg border border-border/40 p-3 hover:border-primary/40 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{AUDIENCE_LABELS[s.audience]}</Badge>
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />{s.estimatedMinutes}m
                        </span>
                      </div>
                      <div className="font-medium">{s.title}</div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {AUDIENCE_ORDER.map((a) => {
              const Icon = AUDIENCE_ICONS[a];
              const count = counts[a] ?? 0;
              return (
                <Link
                  key={a}
                  to={`/help/sops/${a}`}
                  className={`rounded-lg border border-border/40 p-4 hover:border-primary/40 hover:bg-muted/30 transition-colors block ${
                    count === 0 ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {count} SOP{count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="font-semibold">{AUDIENCE_LABELS[a]}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-1">
                    {AUDIENCE_DESCRIPTIONS[a]}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

// ---------------------------------------------------------------------------
// Per-audience list
// ---------------------------------------------------------------------------

function AudienceIndex({ audience }: { audience: SopAudience }) {
  const sops = useMemo(() => listSops(audience), [audience]);
  const Icon = AUDIENCE_ICONS[audience] ?? BookOpen;

  return (
    <MainLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/help/sops"><ArrowLeft className="h-4 w-4 mr-1" /> All audiences</Link>
        </Button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Icon className="h-6 w-6 text-primary" />
            {AUDIENCE_LABELS[audience] ?? audience}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{AUDIENCE_DESCRIPTIONS[audience]}</p>
        </div>

        {sops.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No SOPs published for this audience yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {sops.map((s) => (
              <li key={s.slug}>
                <Link to={`/help/sops/${audience}/${s.slug}`} className="block">
                  <Card className="hover:border-primary/40 hover:bg-muted/30 transition-colors">
                    <CardContent className="p-4 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold mb-0.5">{s.title}</div>
                        {s.description && (
                          <div className="text-sm text-muted-foreground line-clamp-2">{s.description}</div>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{s.estimatedMinutes} min</span>
                          {s.tags.length > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              {s.tags.slice(0, 3).join(" · ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MainLayout>
  );
}

// ---------------------------------------------------------------------------
// SOP detail
// ---------------------------------------------------------------------------

function SopDetail({ audience, slug }: { audience: SopAudience; slug: string }) {
  const navigate = useNavigate();
  const sop = useMemo(() => getSop(audience, slug), [audience, slug]);

  if (!sop) {
    return (
      <MainLayout>
        <div className="max-w-3xl mx-auto">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-sm text-muted-foreground">SOP not found.</p>
              <Button variant="outline" size="sm" onClick={() => navigate("/help/sops")}>
                Back to SOP library
              </Button>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-2 space-y-8">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={`/help/sops/${audience}`}><ArrowLeft className="h-4 w-4 mr-1" /> {AUDIENCE_LABELS[audience]}</Link>
        </Button>

        {/* Document header */}
        <header className="space-y-3 pb-6 border-b border-border/40">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {AUDIENCE_LABELS[audience]}
            </Badge>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />{sop.estimatedMinutes} min read
            </span>
            {sop.updatedAt && (
              <span className="text-xs text-muted-foreground">· updated {sop.updatedAt}</span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">{sop.title}</h1>
          {sop.description && (
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">{sop.description}</p>
          )}
        </header>

        {/* Document body */}
        <article className="sop-body text-[15px] sm:text-base leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-12 mb-4 pb-2 border-b border-border/40">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mt-10 mb-3 text-foreground">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg sm:text-xl font-semibold mt-8 mb-2 text-foreground">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="my-4 leading-relaxed text-foreground/90">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="my-4 ml-6 list-disc space-y-2 marker:text-muted-foreground">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-4 ml-6 list-decimal space-y-2 marker:text-muted-foreground marker:font-medium">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed pl-1 [&>p]:my-1">{children}</li>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <code className={`${className} text-sm`}>{children}</code>
                  );
                }
                return (
                  <code className="px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 font-mono text-[0.875em] text-primary/90 whitespace-nowrap">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="my-6 p-4 rounded-lg bg-muted/40 border border-border/40 overflow-x-auto text-sm leading-relaxed">{children}</pre>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-foreground/95">{children}</em>
              ),
              a: ({ children, href }) => (
                <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80">{children}</a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-5 pl-4 border-l-4 border-primary/40 bg-primary/5 py-3 pr-4 rounded-r-md italic text-foreground/85">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-10 border-border/40" />,
              table: ({ children }) => (
                <div className="my-6 overflow-x-auto rounded-lg border border-border/40">
                  <table className="w-full text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-muted/40 border-b border-border/40">{children}</thead>,
              th: ({ children }) => (
                <th className="px-4 py-2.5 text-left font-semibold text-foreground">{children}</th>
              ),
              td: ({ children }) => (
                <td className="px-4 py-2.5 border-t border-border/30 align-top">{children}</td>
              ),
            }}
          >
            {sop.content}
          </ReactMarkdown>
        </article>

        {/* Document footer */}
        <footer className="pt-8 mt-12 border-t border-border/40 text-xs text-muted-foreground space-y-1">
          <p>This is a controlled operational procedure. Owned by Mithras Customer Operations. Reviewed quarterly.</p>
          {sop.updatedAt && <p>Last reviewed {sop.updatedAt}.</p>}
        </footer>
      </div>
    </MainLayout>
  );
}
