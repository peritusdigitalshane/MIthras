import { Link } from "react-router-dom";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Seo } from "@/components/seo/Seo";
import {
  Warehouse, Briefcase, ArrowRight, ShieldCheck, BarChart3, BookOpen,
  Wallet, Users, Sparkles, MapPin,
} from "lucide-react";

export default function ChannelProgram() {
  return (
    <>
      <Seo
        title="Channel program — Mithras Threat Defence"
        description="Become a Mithras distributor or reseller. Channel-first SMB security with real margins, real sales support, and no direct-sales competition from us."
        canonical="/channel-program"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* Hero */}
        <section className="relative pt-32 pb-20 px-6">
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
            <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/10 rounded-full blur-3xl" />
          </div>
          <div className="container mx-auto max-w-4xl text-center space-y-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border bg-muted/50">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium uppercase tracking-wider">Channel program</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Sell the security platform built for the customers everyone else turns away.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Mithras is sold exclusively through our channel partners. No direct-sales arm competing with you. Real margin built into the price.
              Designed for Australian and New Zealand MSPs targeting the SMBs CrowdStrike and SentinelOne won't quote.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20" asChild>
                <Link to="/contact-sales?intent=partner">Apply now <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
                <a href="#tiers">See partner tiers</a>
              </Button>
            </div>
          </div>
        </section>

        {/* Why Mithras */}
        <section className="py-16 px-6 border-y border-border/40 bg-muted/10">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-10 text-center">
              Why partners choose Mithras
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Reason
                icon={<Wallet className="h-5 w-5" />}
                title="Real margins, no MDF games"
                body="Healthy, recurring margins on every endpoint your customers run. Exact numbers shared on application — no MDF hoop-jumping to access them."
              />
              <Reason
                icon={<ShieldCheck className="h-5 w-5" />}
                title="Channel-only, no conflict"
                body="We have no direct-sales team. Every deal closes through a partner — yours."
              />
              <Reason
                icon={<Users className="h-5 w-5" />}
                title="SMB-shaped pricing"
                body="No 25-seat minimums. Quote an 8-seat dental clinic the same week you quote a 250-seat firm."
              />
              <Reason
                icon={<BookOpen className="h-5 w-5" />}
                title="Sales kit included"
                body="One-pager, pitch deck, demo script, competitive battle cards. Inside the portal from day one."
              />
              <Reason
                icon={<BarChart3 className="h-5 w-5" />}
                title="EOL Windows differentiator"
                body="Mithras hardens Windows 7 / Server 2008 / 2012 — the boxes Falcon and S1 refuse to support. Opens doors at every SMB."
              />
              <Reason
                icon={<MapPin className="h-5 w-5" />}
                title="Australian-built, AUD-billed"
                body="No FX exposure, no offshore support hours. Built in Brisbane, supported during your working day."
              />
            </div>
          </div>
        </section>

        {/* Tiers */}
        <section id="tiers" className="py-20 px-6">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3 text-center">Two tiers, both real</h2>
            <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
              Pick the one that fits how you already do business. You can graduate from Reseller to Distributor as you grow your sub-channel.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Reseller card */}
              <Card className="relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500/60 via-indigo-500 to-indigo-500/60" />
                <CardContent className="p-7 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="h-12 w-12 rounded-xl bg-indigo-500/15 flex items-center justify-center ring-1 ring-indigo-500/20">
                      <Briefcase className="h-6 w-6 text-indigo-500" />
                    </div>
                    <Badge variant="outline">Reseller</Badge>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold tracking-tight">Sell direct to your customers</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      You operate the SOC on behalf of your customers. They get a read-only portal. You bill them.
                    </p>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <Bullet>Full operational SOC console, scoped to each of your customers</Bullet>
                    <Bullet>Buy licences in bulk from your distributor, allocate to customers as you sign them</Bullet>
                    <Bullet>Recurring per-endpoint margin — exact terms on application</Bullet>
                    <Bullet>Co-marketing assets + battle cards in the portal</Bullet>
                    <Bullet>You set the retail price for your customers (we suggest $11)</Bullet>
                  </ul>
                  <div className="pt-3 border-t">
                    <p className="text-xs text-muted-foreground">Best for: MSPs already serving SMBs, IT providers running their own service desk.</p>
                  </div>
                </CardContent>
              </Card>

              {/* Distributor card */}
              <Card className="relative overflow-hidden border-primary/30">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
                <CardContent className="p-7 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center ring-1 ring-primary/20">
                      <Warehouse className="h-6 w-6 text-primary" />
                    </div>
                    <Badge variant="default">Distributor</Badge>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold tracking-tight">Recruit resellers underneath you</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      You sign up resellers, give them a price, support them at L1, bill them monthly. You don't see the end customer's data.
                    </p>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <Bullet>Buy licence pools direct from Mithras, allocate them to resellers as they sign</Bullet>
                    <Bullet>One-click reseller signup with auto-generated URLs</Bullet>
                    <Bullet>Per-reseller pricing (volume tiers, anchor accounts)</Bullet>
                    <Bullet>Roll-up reporting across your whole channel</Bullet>
                    <Bullet>Sales kit + demo tenant access for your reseller training</Bullet>
                  </ul>
                  <div className="pt-3 border-t">
                    <p className="text-xs text-muted-foreground">Best for: existing IT distributors, security-focused master agents, telco/ISP channel programs.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Margin disclosure deliberately not public — it's covered in your
            application response and visible inside the portal after sign-in. */}

        {/* CTA */}
        <section className="py-20 px-6">
          <div className="container mx-auto max-w-2xl text-center space-y-5">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Ready to apply?</h2>
            <p className="text-muted-foreground">
              Tell us about your business, your customer base, and what you'd want from a vendor relationship. We respond personally — no auto-replies.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20" asChild>
                <Link to="/contact-sales?intent=partner">Apply to be a partner <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button size="lg" variant="ghost" className="h-12 px-7 text-base" asChild>
                <a href="mailto:channel@mithras.com.au">channel@mithras.com.au</a>
              </Button>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

function Reason({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
      <span className="text-foreground/90">{children}</span>
    </li>
  );
}
