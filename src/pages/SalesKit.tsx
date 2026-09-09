import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PortalHero } from "@/components/portal/PortalHero";
import {
  FileText, BookOpen, Presentation, Mic, Receipt, Shield, Palette, GraduationCap,
  Download, Eye, AlertCircle, Sparkles, Warehouse, ShieldCheck, Wrench,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Each asset has a Markdown source served from the public folder (so it can
// be deep-linked + cached). PDFs will arrive later — placeholder URLs for now.
interface Asset {
  key: string;
  title: string;
  description: string;
  icon: typeof FileText;
  format: "md" | "pdf" | "deck";
  // Path under /sales/ in the repo. Surfaced via /sales-files/* (proxied) at runtime.
  source: string;
  // Length / format chip text.
  meta: string;
  // The "must-do" priority for a new partner.
  priority?: "essential" | "recommended" | "reference";
}

const ASSETS: Asset[] = [
  {
    key: "disty-playbook",
    title: "Distributor playbook",
    description: "The operational manual: how the credit model works, billing, reseller onboarding, support escalation, contracts.",
    icon: Wrench,
    format: "md",
    source: "/sales-files/disty-playbook.md",
    meta: "Operations · 10 min",
    priority: "essential",
  },
  {
    key: "one-pager",
    title: "Mithras one-pager",
    description: "Hand this to a prospect before or after a demo. 1 page, glanceable.",
    icon: FileText,
    format: "md",
    source: "/sales-files/one-pager.md",
    meta: "1 page · Markdown",
    priority: "essential",
  },
  {
    key: "pitch-deck",
    title: "10-slide pitch deck",
    description: "Convert the outline to Keynote/Google Slides with your branding. Talk-track included.",
    icon: Presentation,
    format: "deck",
    source: "/sales-files/pitch-deck.md",
    meta: "10 slides · 10 mins",
    priority: "essential",
  },
  {
    key: "demo-script",
    title: "15-minute demo script",
    description: "Step-by-step product demo. Memorise the EOL hardening + AI SOC beats — those are the close.",
    icon: Mic,
    format: "md",
    source: "/sales-files/demo-script.md",
    meta: "15 mins · 9 beats",
    priority: "essential",
  },
  {
    key: "pricing-sheet",
    title: "Pricing & margins",
    description: "Distributor + reseller + retail tiers, worked examples, volume discounts, billing terms.",
    icon: Receipt,
    format: "md",
    source: "/sales-files/pricing-sheet.md",
    meta: "Live pricing",
    priority: "essential",
  },
  {
    key: "battle-cards",
    title: "Competitive battle cards",
    description: "How to handle CrowdStrike, Huntress, Defender for Endpoint Plan 2, SentinelOne, Sophos, Acronis.",
    icon: Shield,
    format: "md",
    source: "/sales-files/battle-cards.md",
    meta: "7 competitors",
    priority: "recommended",
  },
  {
    key: "brand-kit",
    title: "Brand kit",
    description: "Logo usage, colour palette, voice & tone, what to say + what not to say.",
    icon: Palette,
    format: "md",
    source: "/sales-files/brand-kit.md",
    meta: "Style guide",
    priority: "reference",
  },
  {
    key: "reseller-onboarding",
    title: "Reseller first-week playbook",
    description: "Step-by-step for a new reseller to close their first deal by Friday of week 1.",
    icon: GraduationCap,
    format: "md",
    source: "/sales-files/reseller-onboarding.md",
    meta: "5 days · 1 deal",
    priority: "recommended",
  },
];

interface Props {
  // Tier this page is rendered for; controls hero copy + accent.
  tier: "distributor" | "partner";
}

export default function SalesKit({ tier }: Props) {
  const { isSuperAdmin } = useTenant();
  const [previewing, setPreviewing] = useState<Asset | null>(null);
  const [content, setContent]       = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);

  const openPreview = async (a: Asset) => {
    setPreviewing(a); setContent(""); setContentLoading(true);
    try {
      const r = await fetch(a.source, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`Couldn't load (${r.status})`);
      const text = await r.text();
      setContent(text);
    } catch (e: any) {
      setContent(`# Couldn't load preview\n\n${e.message ?? "Unknown error"}\n\nIf this keeps happening, the markdown source may not be deployed yet — contact channel@mithras.com.au.`);
    } finally {
      setContentLoading(false);
    }
  };

  const accent  = tier === "distributor" ? "primary" : "indigo";
  const eyebrow = tier === "distributor" ? "Distributor portal" : "Partner portal";
  const eyebrowIcon = tier === "distributor"
    ? <Warehouse className="h-3.5 w-3.5" />
    : <ShieldCheck className="h-3.5 w-3.5" />;

  const grouped = {
    essential:   ASSETS.filter(a => a.priority === "essential"),
    recommended: ASSETS.filter(a => a.priority === "recommended"),
    reference:   ASSETS.filter(a => a.priority === "reference"),
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <PortalHero
          eyebrow={eyebrow}
          eyebrowIcon={eyebrowIcon}
          title="Sales kit"
          subtitle="Everything you need to pitch and close Mithras. Pre-built artefacts you can hand to prospects, your sales team, or your distributor's sales team."
          accent={accent}
          actions={
            <Badge variant="outline" className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-3 w-3 mr-1" /> Updated 2026-06-06
            </Badge>
          }
        />

        <Section title="Essential — read first" tone="primary">
          {grouped.essential.map(a => <AssetCard key={a.key} asset={a} onPreview={openPreview} />)}
        </Section>

        <Section title="Recommended" tone="muted">
          {grouped.recommended.map(a => <AssetCard key={a.key} asset={a} onPreview={openPreview} />)}
        </Section>

        <Section title="Reference" tone="muted">
          {grouped.reference.map(a => <AssetCard key={a.key} asset={a} onPreview={openPreview} />)}
        </Section>

        {isSuperAdmin && (
          <Card className="border-dashed">
            <CardContent className="p-5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" /> Super-admin note
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                These markdown sources live in <code>/sales/</code> in the repo and need to be deployed to the
                frontend's public folder (or served from a CDN) so resellers can fetch them. v2 will move them
                into Supabase Storage with proper RLS and a PDF rendering pipeline.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!previewing} onOpenChange={(o) => !o && setPreviewing(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewing && <previewing.icon className="h-5 w-5 text-primary" />}
              {previewing?.title}
            </DialogTitle>
          </DialogHeader>
          {/* MAJOR fix: render markdown as styled prose instead of a raw <pre>
              dump. Partners were reading raw "## heading" syntax in a code font
              and assumed the page was broken. */}
          <div className="border-t pt-4 max-h-[70vh] overflow-y-auto">
            {contentLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

function Section({ title, tone, children }: { title: string; tone: "primary" | "muted"; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className={`text-sm uppercase tracking-wider font-semibold ${tone === "primary" ? "text-primary" : "text-muted-foreground"}`}>{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

function AssetCard({ asset, onPreview }: { asset: Asset; onPreview: (a: Asset) => void }) {
  const Icon = asset.icon;
  return (
    <Card className="group hover:border-primary/40 transition-colors overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <Badge variant="outline" className="text-[10px]">{asset.meta}</Badge>
        </div>
        <CardTitle className="text-base mt-3">{asset.title}</CardTitle>
        <CardDescription className="text-xs">{asset.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onPreview(asset)}>
            <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={asset.source} download>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
