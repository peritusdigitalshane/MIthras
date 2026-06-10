import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmptyStateStep {
  label: string;
  done?: boolean;
  href?: string;
  detail?: string;
}

interface EmptyStateProps {
  /** Icon at the top -- pass any Lucide element. */
  icon?: React.ReactNode;
  /** Positive-framed title -- "No threats — that's a good thing" beats "No data". */
  title: string;
  /** Optional paragraph explaining what populates this view. */
  description?: React.ReactNode;
  /** Optional checklist of steps the operator should follow. */
  steps?: EmptyStateStep[];
  /** Primary CTA (button styled). */
  primaryAction?: { label: string; href?: string; onClick?: () => void };
  /** Secondary CTA (text link styled). */
  secondaryAction?: { label: string; href?: string };
  /** Visual tone: muted (default), positive (e.g. "no threats"), or warning. */
  tone?: "default" | "positive" | "warning";
  /** Compact rendering for narrower contexts (tabs, cards). */
  compact?: boolean;
}

/**
 * Replaces "No data" with a teaching panel: tells the user WHY the surface is
 * empty + what to do to populate it. Empty isn't a dead end -- it's a moment
 * where the platform can guide.
 *
 * Example:
 *   <EmptyState
 *     icon={<Shield />}
 *     title="No threats detected — that's a good sign"
 *     description="Real-time Defender detections appear here within ~60s of the event."
 *     steps={[
 *       { done: endpointsCount > 0, label: "Deploy the Mithras agent" },
 *       { done: hasPolicy, label: "Assign a Defender policy" },
 *       { done: false, label: "Drop EICAR to test ingestion" },
 *     ]}
 *     primaryAction={{ label: "Test with EICAR", href: "/guides/eicar" }}
 *   />
 */
export function EmptyState({
  icon,
  title,
  description,
  steps,
  primaryAction,
  secondaryAction,
  tone = "default",
  compact,
}: EmptyStateProps) {
  const toneBorder =
    tone === "positive" ? "border-green-500/20 bg-green-500/5"
    : tone === "warning" ? "border-amber-500/20 bg-amber-500/5"
    : "border-muted bg-muted/20";

  const iconColor =
    tone === "positive" ? "text-green-600 dark:text-green-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground/70";

  return (
    <div
      className={`mx-auto flex max-w-md flex-col items-center rounded-lg border ${toneBorder} px-6 ${compact ? "py-6" : "py-10"} text-center`}
    >
      {icon && (
        <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background/60 ${iconColor}`}>
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {description && (
        <div className="mt-2 text-sm text-muted-foreground [&_p]:leading-relaxed [&_p+p]:mt-2">
          {description}
        </div>
      )}

      {steps && steps.length > 0 && (
        <ol className="mt-5 w-full space-y-2 text-left">
          {steps.map((s, i) => {
            const Inner = (
              <div className="flex items-start gap-2.5">
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                <div className="space-y-0.5">
                  <p className={`text-sm ${s.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {s.label}
                  </p>
                  {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                </div>
              </div>
            );
            return (
              <li key={i}>
                {s.href && !s.done ? (
                  <Link to={s.href} className="block rounded-md px-2 py-1 transition-colors hover:bg-background/60">
                    {Inner}
                  </Link>
                ) : (
                  <div className="px-2 py-1">{Inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex items-center gap-3">
          {primaryAction &&
            (primaryAction.href ? (
              <Button asChild>
                <Link to={primaryAction.href}>
                  {primaryAction.label}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <Button onClick={primaryAction.onClick}>
                {primaryAction.label}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ))}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Link to={secondaryAction.href} className="text-sm text-muted-foreground hover:text-foreground">
                {secondaryAction.label}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">{secondaryAction.label}</span>
            ))}
        </div>
      )}
    </div>
  );
}
