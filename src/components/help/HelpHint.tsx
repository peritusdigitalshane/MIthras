import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "react-router-dom";

interface HelpHintProps {
  title: string;
  children: React.ReactNode;
  learnMore?: string;          // optional anchor or path -- e.g. "/glossary#microseg-learning"
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  iconClassName?: string;
}

/**
 * Inline "?" help button next to a control or term. Click opens a small
 * popover with an explanation; optional Learn more link to the glossary.
 *
 * Usage:
 *   <Badge>learning</Badge>
 *   <HelpHint title="What is learning mode?" learnMore="/glossary#microseg-learning">
 *     <p>The agent watches every connection but blocks nothing.</p>
 *   </HelpHint>
 */
export function HelpHint({
  title,
  children,
  learnMore,
  side = "top",
  align = "start",
  iconClassName,
}: HelpHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${title}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className={`h-3.5 w-3.5 ${iconClassName ?? ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-80 text-sm">
        <div className="mb-2 font-medium leading-tight">{title}</div>
        <div className="space-y-2 text-muted-foreground [&_p]:leading-snug [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4">
          {children}
        </div>
        {learnMore && (
          <Link
            to={learnMore}
            className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
          >
            Read more in the glossary →
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
