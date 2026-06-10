import { HelpCircle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export interface PageHelpTask {
  label: string;
  href?: string;       // optional in-app link
  detail?: string;     // optional secondary line
}

export interface PageHelpFaq {
  q: string;
  a: React.ReactNode;
}

interface PageHelpProps {
  /** Page name shown as the drawer title. */
  title: string;
  /** One-paragraph explanation in plain English. */
  whatIsThis: React.ReactNode;
  /** "Common tasks" -- numbered playbook the operator can follow. */
  tasks?: PageHelpTask[];
  /** FAQ entries -- collapsed by default. */
  faq?: PageHelpFaq[];
  /** Direct anchor link into the glossary; defaults to /glossary. */
  glossaryAnchor?: string;
  /** Customise the trigger label (default "?" icon button). */
  triggerLabel?: string;
}

/**
 * Page-level help drawer. Renders a small "?" trigger that opens a side
 * sheet with structured help: what the page does, common tasks, FAQ,
 * link to the glossary.
 *
 * Drop it next to a page H1:
 *
 *   <div className="flex items-center gap-2">
 *     <h1>Microsegmentation</h1>
 *     <PageHelp title="Microsegmentation" whatIsThis="..." tasks={[...]} faq={[...]} />
 *   </div>
 */
export function PageHelp({
  title,
  whatIsThis,
  tasks,
  faq,
  glossaryAnchor = "/glossary",
  triggerLabel,
}: PageHelpProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Help: ${title}`}
        >
          <HelpCircle className="h-4 w-4" />
          {triggerLabel ?? "Help"}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>How this page works + common tasks.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">What is this page?</h3>
            <div className="space-y-2 text-foreground/90 [&_p]:leading-relaxed">{whatIsThis}</div>
          </section>

          {tasks && tasks.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Common tasks</h3>
              <ol className="space-y-2">
                {tasks.map((t, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="space-y-0.5">
                      {t.href ? (
                        <Link to={t.href} className="text-primary hover:underline">{t.label}</Link>
                      ) : (
                        <span className="text-foreground">{t.label}</span>
                      )}
                      {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {faq && faq.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">FAQ</h3>
              <Accordion type="single" collapsible className="border rounded-md">
                {faq.map((f, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="px-3 border-b last:border-b-0">
                    <AccordionTrigger className="text-left text-sm py-2.5">{f.q}</AccordionTrigger>
                    <AccordionContent className="pb-3 text-muted-foreground space-y-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4">
                      {f.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          )}

          <div className="pt-2 border-t">
            <Link to={glossaryAnchor} className="text-xs font-medium text-primary hover:underline">
              Open glossary →
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
