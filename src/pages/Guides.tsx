import { useState } from "react";
import { Link } from "react-router-dom";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { GuidePlayer } from "@/components/landing/GuidePlayer";
import { GUIDES, Guide } from "@/data/guides";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PlayCircle, Clock, ArrowRight } from "lucide-react";

const Guides = () => {
  const [active, setActive] = useState<Guide | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <LandingNav />

      <section className="pt-32 pb-12 px-6">
        <div className="container mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
            <PlayCircle className="h-3.5 w-3.5" />
            Platform guides
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
            Watch Mithras in 90 seconds.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Short, narrated walkthroughs of the workflows your team will use every day.
            Microsegmentation, EDR telemetry, monthly customer reports, DNS filtering.
          </p>
        </div>
      </section>

      <section className="pb-24 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="grid md:grid-cols-2 gap-6">
            {GUIDES.map((guide) => (
              <GuideCard key={guide.slug} guide={guide} onPlay={() => setActive(guide)} />
            ))}
          </div>

          <div className="mt-16 rounded-2xl border border-border/40 bg-card p-8 text-center">
            <h2 className="text-xl font-semibold mb-2">Want a personal walkthrough?</h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-6">
              30-minute live demo of the platform tailored to the workflows your MSP runs every
              day. Bring questions.
            </p>
            <Button asChild size="lg" className="gap-2">
              <Link to="/contact-sales">
                Book a demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-5xl p-0 border-none bg-transparent shadow-none">
          {active && <GuidePlayer guide={active} onClose={() => setActive(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function GuideCard({ guide, onPlay }: { guide: Guide; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="group text-left rounded-2xl border border-border/40 bg-card overflow-hidden hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 transition-all"
    >
      <div className="aspect-video w-full bg-slate-950 relative overflow-hidden">
        <guide.Thumbnail />
      </div>
      <div className="relative -mt-16 mb-2 flex items-end justify-between px-5 pointer-events-none">
        <div className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl shadow-primary/40 group-hover:scale-110 transition-transform">
          <PlayCircle className="h-7 w-7" />
        </div>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-xs">
          <Clock className="h-3 w-3" />
          {Math.floor(guide.durationSec / 60)}:
          {(guide.durationSec % 60).toString().padStart(2, "0")}
        </div>
      </div>
      <div className="p-5 pt-2">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
            {guide.category}
          </Badge>
        </div>
        <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
          {guide.title}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{guide.oneLiner}</p>
      </div>
    </button>
  );
}

export default Guides;
