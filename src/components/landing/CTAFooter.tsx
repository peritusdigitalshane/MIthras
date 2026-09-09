import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Mail, MapPin } from "lucide-react";

export function CTASection() {
  return (
    <section className="relative py-24 px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/15 rounded-full blur-3xl" />
      </div>
      <div className="container mx-auto">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-5 tracking-tight">
            Ready to lock down your fleet?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-10 text-lg">
            Mithras is sold exclusively through our channel partner network. Tell us about your fleet
            and we'll put you in touch with a reseller who can deploy and support you locally.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/30" asChild>
              <Link to="/contact-sales">
                Talk to sales
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
              <Link to="/channel-program">Become a partner</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-muted/20">
      <div className="container mx-auto px-6 py-16">
        <div className="grid md:grid-cols-12 gap-10 mb-12">
          {/* Brand column */}
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 mb-4">
              <img
                src="/mithras-shield.svg"
                alt="Mithras"
                className="h-10 w-10"
                width={40}
                height={40}
              />
              <div className="flex flex-col leading-tight">
                <span className="text-base font-extrabold tracking-[0.18em]">MITHRAS</span>
                <span className="text-[10px] tracking-[0.22em] uppercase text-primary">
                  Threat Defence
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              Endpoint security &amp; microsegmentation for MSPs and the SMBs they serve.
              Built in Australia.
            </p>
            <div className="mt-6 space-y-2 text-sm">
              <a
                href="mailto:hello@mithras.com.au"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Mail className="h-4 w-4" />
                hello@mithras.com.au
              </a>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                Australia
              </div>
            </div>
          </div>

          {/* Link columns */}
          <FooterColumn
            title="Platform"
            links={[
              { label: "AI SOC", href: "/ai-soc" },
              { label: "End-of-life Windows", href: "/eol-windows" },
              { label: "Microsegmentation", href: "/platform#microseg" },
              { label: "Defender management", href: "/platform#defender" },
              { label: "Application control", href: "/platform#app-control" },
              { label: "Threat Intel", href: "/intel" },
            ]}
          />
          <FooterColumn
            title="For MSPs"
            links={[
              { label: "MSP overview", href: "/for-msps" },
              { label: "Channel program", href: "/channel-program" },
              { label: "Pricing", href: "/pricing" },
              { label: "Sign in", href: "/login" },
            ]}
          />
          <FooterColumn
            title="For home users"
            links={[
              { label: "Mithras Personal", href: "/personal" },
              { label: "Sign in", href: "/login?role=customer" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { label: "Blog", href: "/blog" },
              { label: "Guides", href: "/guides" },
              { label: "Contact sales", href: "/contact-sales" },
              { label: "Status", href: "/status" },
              { label: "Security", href: "/security" },
            ]}
          />
        </div>

        <div className="pt-8 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>
            &copy; {new Date().getFullYear()} Mithras Threat Defence&trade;. All rights reserved.
          </div>
          <div className="flex items-center gap-5">
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/acceptable-use" className="hover:text-foreground transition-colors">
              Acceptable use
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  const renderLink = (l: { label: string; href: string }) => {
    if (l.href.startsWith("/") && !l.href.startsWith("//")) {
      return (
        <Link
          to={l.href}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {l.label}
        </Link>
      );
    }
    return (
      <a
        href={l.href}
        className="text-muted-foreground hover:text-foreground transition-colors"
        target={l.href.startsWith("http") ? "_blank" : undefined}
        rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        {l.label}
      </a>
    );
  };

  return (
    <div className="md:col-span-2">
      <h4 className="text-xs font-semibold tracking-[0.14em] uppercase text-foreground/80 mb-4">
        {title}
      </h4>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>{renderLink(l)}</li>
        ))}
      </ul>
    </div>
  );
}
