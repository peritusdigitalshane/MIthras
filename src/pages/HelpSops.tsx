import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
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
      <div className="max-w-3xl mx-auto space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={`/help/sops/${audience}`}><ArrowLeft className="h-4 w-4 mr-1" /> {AUDIENCE_LABELS[audience]}</Link>
        </Button>

        <div>
          <div className="flex items-center gap-2 mb-2">
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
          <h1 className="text-3xl font-bold tracking-tight">{sop.title}</h1>
          {sop.description && (
            <p className="text-base text-muted-foreground mt-2">{sop.description}</p>
          )}
        </div>

        <Card>
          <CardContent className="py-6">
            <article className="prose prose-sm sm:prose-base dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base prose-a:text-primary">
              <ReactMarkdown>{sop.content}</ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
