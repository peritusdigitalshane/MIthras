import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Circle, ChevronRight, X, Sparkles, ArrowRight,
} from "lucide-react";

export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  // Action that primarily completes the step.
  action: { label: string; href?: string; onClick?: () => void };
  // Caller decides if it's done — based on counts, settings, completion log, etc.
  done: boolean;
  // Optional steps don't count toward N/M completion; rendered as "tip" rather
  // than a tickable item. Use for "recommended reading" type guidance.
  optional?: boolean;
}

interface Props {
  // Distinguishes the checklist instance in localStorage.
  scope: "distributor" | "partner";
  // Pretty name to show in the welcome banner.
  orgName: string;
  steps: OnboardingStep[];
}

// Dismissable, persistent first-login checklist. Caller owns the `done` logic;
// this component handles persistence of the *dismissed* state in localStorage
// so it doesn't reappear after dismissal.
export function PortalOnboarding({ scope, orgName, steps }: Props) {
  const storageKey = `mithras-onboarding-dismissed-${scope}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "true";
  });

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(storageKey, "true"); } catch {}
  };

  // Optional steps (tips/recommended reading) don't count toward N/M progress.
  const required  = useMemo(() => steps.filter(s => !s.optional), [steps]);
  const doneCount = useMemo(() => required.filter(s => s.done).length, [required]);
  const allDone   = doneCount === required.length;

  // Once complete, the banner can be cleared and not reappear.
  if (dismissed) return null;

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-primary/0 to-transparent">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <CardContent className="p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base">Welcome, {orgName}</h3>
              <Badge variant="outline" className="text-[10px] font-medium">
                {doneCount}/{required.length} complete
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {allDone
                ? "You're set up — feel free to dismiss this. The portal is yours."
                : "A 5-minute setup so your first deal closes this week, not next month."}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {steps.map(s => (
            <StepRow key={s.key} step={s} />
          ))}
        </div>

        {allDone && (
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Hide this <X className="h-3 w-3 ml-1.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: OnboardingStep }) {
  const Icon = step.optional ? Sparkles : step.done ? CheckCircle2 : Circle;
  const iconColor = step.optional ? "text-indigo-400"
                   : step.done    ? "text-emerald-500"
                                  : "text-muted-foreground";
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border bg-background/50 p-3 transition-colors",
      step.optional   ? "border-indigo-500/20" :
      step.done       ? "border-emerald-500/30 bg-emerald-500/5" : "hover:border-primary/30",
    )}>
      <Icon className={cn("h-5 w-5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", !step.optional && step.done && "line-through text-muted-foreground")}>
          {step.title}
          {step.optional && <Badge variant="outline" className="ml-2 text-[10px] py-0">Tip</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{step.description}</div>
      </div>
      {(step.optional || !step.done) && (
        step.action.href ? (
          <Button asChild size="sm" variant="ghost" className="shrink-0">
            <Link to={step.action.href}>
              {step.action.label} <ChevronRight className="h-3 w-3 ml-0.5" />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={step.action.onClick}>
            {step.action.label} <ArrowRight className="h-3 w-3 ml-0.5" />
          </Button>
        )
      )}
    </div>
  );
}
