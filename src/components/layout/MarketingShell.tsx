import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";

interface MarketingShellProps {
  children: React.ReactNode;
}

/**
 * Layout wrapper for public marketing routes (legal pages, blog, status,
 * security). Keeps the same nav + footer the landing page uses so a visitor
 * never loses the navigation context.
 */
export function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <LandingNav />
      <main className="flex-1 pt-24">{children}</main>
      <Footer />
    </div>
  );
}
