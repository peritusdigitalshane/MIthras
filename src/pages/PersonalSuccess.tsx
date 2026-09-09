import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";

export default function PersonalSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");

  return (
    <>
      <Seo
        title="You're subscribed | Mithras Personal"
        description="Your Mithras Personal subscription is active. Check your inbox for the install link and your account access."
        canonical="/personal/success"
        noindex
      />
      <div className="min-h-screen bg-background">
        <LandingNav />
        <section className="pt-32 pb-16 px-4 sm:px-6">
          <div className="container mx-auto max-w-2xl">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 sm:p-12 text-center">
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-5">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
                You're protected.
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-md mx-auto">
                Payment received. Two emails are on the way: your install link, and a sign-in link for managing your subscription.
              </p>
            </div>

            <div className="grid gap-4 mt-8">
              <div className="flex items-start gap-4 rounded-xl border bg-card p-5">
                <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground mb-1">Check your inbox</p>
                  <p className="text-muted-foreground">
                    The welcome email contains a one-line PowerShell command. Copy it, paste into PowerShell (Run as administrator), and the agent installs in about a minute.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border bg-card p-5">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground mb-1">What happens next</p>
                  <p className="text-muted-foreground">
                    After install, the tray icon turns green and Mithras runs in the background. You'll get an email if anything is detected on your PC. A monthly security summary lands on the first of each month.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-2">
                <Button asChild size="lg">
                  <Link to="/account">
                    Open my account <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/help/sops/home_user/install-mithras-personal">
                    Install instructions
                  </Link>
                </Button>
              </div>

              {sessionId && (
                <p className="text-center text-[11px] text-muted-foreground/60 mt-4">
                  Receipt reference: <span className="font-mono">{sessionId.slice(0, 24)}…</span>
                </p>
              )}
            </div>
          </div>
        </section>
        <Footer />
      </div>
    </>
  );
}
