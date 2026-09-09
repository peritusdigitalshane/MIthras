import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown, Shield, Briefcase, Warehouse, Home, Menu, X,
  Bot, History, Network, Lock, ShieldCheck, Users, BookOpen, FileText, Activity, Mail,
} from "lucide-react";

/**
 * Multi-page nav, modelled on Huntress's IA: a Platform dropdown
 * (deep-dive capability pages), a Solutions dropdown (audience), a
 * Pricing link, a Partners link, the role-aware sign-in dropdown that
 * was already here, and the primary Talk-to-sales CTA. Mobile collapses
 * to a slide-down menu that preserves the same hierarchy.
 */
export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <img src="/mithras-shield.svg" alt="Mithras Threat Defence" className="h-8 w-8 sm:h-9 sm:w-9" width={36} height={36} />
          <div className="flex flex-col leading-tight">
            <span className="text-sm sm:text-base font-extrabold tracking-[0.18em]">MITHRAS</span>
            <span className="text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-primary">Threat Defence</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-1">
          <PlatformDropdown />
          <SolutionsDropdown />
          <NavLink to="/pricing">Pricing</NavLink>
          <NavLink to="/intel">Threat Intel</NavLink>
          <NavLink to="/channel-program">Partners</NavLink>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Sign-in role-picker (kept from previous nav) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 hidden sm:inline-flex">
                Sign in <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Choose your portal</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/login?role=customer" className="cursor-pointer">
                  <Shield className="h-4 w-4 mr-2 text-emerald-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Customer</span>
                    <span className="text-[11px] text-muted-foreground">See your own security posture</span>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/login?role=partner" className="cursor-pointer">
                  <Briefcase className="h-4 w-4 mr-2 text-indigo-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Partner</span>
                    <span className="text-[11px] text-muted-foreground">MSP / reseller console</span>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/login?role=distributor" className="cursor-pointer">
                  <Warehouse className="h-4 w-4 mr-2 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Distributor</span>
                    <span className="text-[11px] text-muted-foreground">Sales kit + channel management</span>
                  </div>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" className="hidden sm:inline-flex" asChild>
            <Link to="/contact-sales">Talk to sales</Link>
          </Button>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-9 w-9 px-0"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border/40 bg-background/95 backdrop-blur-xl">
          <div className="container mx-auto px-4 sm:px-6 py-4 max-h-[calc(100vh-64px)] overflow-y-auto">
            <MobileSection title="Platform">
              <MobileLink to="/ai-soc" icon={<Bot className="h-4 w-4" />} title="AI SOC" detail="5-agent triage" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/phishing-protection" icon={<Mail className="h-4 w-4" />} title="Email security" detail="Phishing + BEC protection for M365" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/identity-defence" icon={<Lock className="h-4 w-4" />} title="Identity Defence" detail="CA outcomes without P1" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/m365-shield" icon={<Shield className="h-4 w-4" />} title="M365 Shield" detail="PIM, risk, OAuth — skip Premium upgrade" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/eol-windows" icon={<History className="h-4 w-4" />} title="EOL Windows" detail="Defend Win 7/8.1/Server 2012 R2" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/platform" icon={<Network className="h-4 w-4" />} title="The full platform" detail="All 8 capabilities" onClick={() => setMobileOpen(false)} />
            </MobileSection>
            <MobileSection title="Solutions">
              <MobileLink to="/for-msps" icon={<Briefcase className="h-4 w-4" />} title="For MSPs" detail="Multi-tenant + channel margins" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/personal" icon={<Home className="h-4 w-4" />} title="For home" detail="$6/mo for your personal devices" onClick={() => setMobileOpen(false)} />
            </MobileSection>
            <MobileSection title="More">
              <MobileLink to="/intel" icon={<Activity className="h-4 w-4" />} title="Threat Intel" detail="Live SMB threat landscape" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/pricing" icon={<FileText className="h-4 w-4" />} title="Pricing" detail="Per-endpoint, predictable" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/channel-program" icon={<Users className="h-4 w-4" />} title="Partners" detail="Channel program + become a partner" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/blog" icon={<BookOpen className="h-4 w-4" />} title="Blog" detail="Recent posts" onClick={() => setMobileOpen(false)} />
            </MobileSection>
            <MobileSection title="Sign in">
              <MobileLink to="/login?role=customer" icon={<Shield className="h-4 w-4 text-emerald-500" />} title="Customer" detail="Your security posture" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/login?role=partner" icon={<Briefcase className="h-4 w-4 text-indigo-500" />} title="Partner" detail="MSP / reseller console" onClick={() => setMobileOpen(false)} />
              <MobileLink to="/login?role=distributor" icon={<Warehouse className="h-4 w-4 text-primary" />} title="Distributor" detail="Channel management" onClick={() => setMobileOpen(false)} />
            </MobileSection>
            <div className="pt-2">
              <Button className="w-full" asChild>
                <Link to="/contact-sales" onClick={() => setMobileOpen(false)}>Talk to sales</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md"
    >
      {children}
    </Link>
  );
}

function PlatformDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          Platform <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Capabilities</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DesktopMenuItem to="/ai-soc" icon={<Bot className="h-4 w-4 text-primary" />} title="AI SOC" detail="Five agents triage every alert" />
        <DesktopMenuItem to="/phishing-protection" icon={<Mail className="h-4 w-4 text-cyan-500" />} title="Email security" detail="AI phishing + BEC protection for M365" />
        <DesktopMenuItem to="/identity-defence" icon={<Lock className="h-4 w-4 text-rose-500" />} title="Identity Defence" detail="Conditional Access outcomes without P1" />
        <DesktopMenuItem to="/m365-shield" icon={<Shield className="h-4 w-4 text-primary" />} title="M365 Shield" detail="PIM, risk scoring, OAuth — skip the Premium upgrade" />
        <DesktopMenuItem to="/eol-windows" icon={<History className="h-4 w-4 text-amber-500" />} title="EOL Windows hardening" detail="Cover Win 7 / 8.1 / Server 2012 R2" />
        <DesktopMenuItem to="/platform#microseg" icon={<Network className="h-4 w-4 text-blue-500" />} title="Microsegmentation" detail="Learn-mode firewall, lock-down workflow" />
        <DesktopMenuItem to="/platform#defender" icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />} title="Defender management" detail="All 16 ASR rules, no E5 required" />
        <DesktopMenuItem to="/platform#app-control" icon={<Lock className="h-4 w-4 text-purple-500" />} title="Application control (WDAC)" detail="Audit-first whitelisting" />
        <DropdownMenuSeparator />
        <DesktopMenuItem to="/platform" icon={<FileText className="h-4 w-4 text-muted-foreground" />} title="The whole platform" detail="All 8 capabilities in one view" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SolutionsDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          Solutions <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">By audience</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DesktopMenuItem to="/for-msps" icon={<Briefcase className="h-4 w-4 text-primary" />} title="For MSPs" detail="Multi-tenant + channel margins" />
        <DesktopMenuItem to="/personal" icon={<Home className="h-4 w-4 text-indigo-500" />} title="For home" detail="$6/mo for personal devices" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesktopMenuItem({
  to, icon, title, detail,
}: { to: string; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <DropdownMenuItem asChild>
      <Link to={to} className="cursor-pointer">
        <span className="mr-3 flex-shrink-0">{icon}</span>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-[11px] text-muted-foreground">{detail}</span>
        </div>
      </Link>
    </DropdownMenuItem>
  );
}

function MobileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium px-3 mb-1">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function MobileLink({
  to, icon, title, detail, onClick,
}: { to: string; icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-card/60 active:bg-card/80 transition-colors"
    >
      <span className="text-primary flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{detail}</div>
      </div>
    </Link>
  );
}
