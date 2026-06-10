import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface MainLayoutProps {
  children: React.ReactNode;
}

// Responsive shell. On md+ the sidebar is a fixed 16rem column.
// On mobile the sidebar is hidden by default and opens as a Sheet drawer
// via a hamburger button rendered inside the Header (Header.tsx owns the
// mobileOpen callback so it can render the trigger inside its sticky bar
// without nesting two sticky containers — nested sticky breaks scrolling).
export function MainLayout({ children }: MainLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
    </div>
  );
}
