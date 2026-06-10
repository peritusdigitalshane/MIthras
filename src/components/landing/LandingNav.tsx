import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Shield, Briefcase, Warehouse, Home } from "lucide-react";

export function LandingNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src="/mithras-shield.svg" alt="Mithras Threat Defence" className="h-9 w-9" width={36} height={36} />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-extrabold tracking-[0.18em]">MITHRAS</span>
            <span className="text-[10px] tracking-[0.22em] uppercase text-primary">Threat Defence</span>
          </div>
        </Link>
        <div className="hidden md:flex items-center gap-7">
          <a href="/#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="/#platform" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Platform</a>
          <a href="/#msp" className="text-sm text-muted-foreground hover:text-foreground transition-colors">For MSPs</a>
          <a href="/#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
          <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Blog</Link>
          <Link to="/guides" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Guides</Link>
        </div>
        <div className="flex items-center gap-2">
          {/* Role-aware sign-in. The dropdown items pass ?role=… so Login can
              redirect post-auth to the right portal landing — anyone reaching
              /login without a role continues to land on /dashboard like before,
              preserving the existing user experience. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
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
          <Button variant="outline" size="sm" asChild>
            <Link to="/personal"><Home className="h-3.5 w-3.5 mr-1" />Personal</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/contact-sales">Talk to sales</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}
