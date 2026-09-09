import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SocChatPanel } from "@/components/soc/SocChatPanel";
import { useTenant } from "@/contexts/TenantContext";

interface MainLayoutProps {
  children: React.ReactNode;
}

// Responsive shell. On md+ the sidebar is a fixed 16rem column.
// On mobile the sidebar is hidden by default and opens as a Sheet drawer
// via a hamburger button rendered inside the Header (Header.tsx owns the
// mobileOpen callback so it can render the trigger inside its sticky bar
// without nesting two sticky containers — nested sticky breaks scrolling).
//
// The SocChatPanel renders its own floating action button (bottom-right)
// and slides out as a Sheet — visible from every page that wraps in
// MainLayout, which is the entire SOC console.
export function MainLayout({ children }: MainLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currentOrganization, isSuperAdmin } = useTenant();
  // F2 fix: SOC chat is an operator/MSP affordance — customers and home
  // users shouldn't see it. Super-admins keep it everywhere (including
  // when impersonating).
  const orgType = currentOrganization?.organization_type;
  const showSocChat =
    isSuperAdmin ||
    orgType === "partner" ||
    orgType === "distributor" ||
    orgType == null; // pre-tenant routes
  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 max-w-[85vw]">
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="md:pl-64">
        <Header onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="p-4 sm:p-6">{children}</main>
      </div>

      {/* Conversational interface to the AI SOC. Gated by org type — customers
          and home users shouldn't see it. */}
      {showSocChat && <SocChatPanel />}
    </div>
  );
}
