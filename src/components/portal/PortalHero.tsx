import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  // Small label above the title, e.g. "Distributor portal".
  eyebrow: string;
  eyebrowIcon?: ReactNode;
  // The org name (big).
  title: string;
  // One-line description under the title.
  subtitle?: string;
  // Right-hand badge content (Active / Suspended / etc).
  status?: { label: string; tone: "ok" | "warn" | "bad" };
  // Optional action buttons on the right.
  actions?: ReactNode;
  // Optional accent class to tint the gradient per-portal.
  accent?: "primary" | "indigo" | "emerald";
}

const ACCENTS: Record<NonNullable<Props["accent"]>, string> = {
  primary: "from-primary/30 via-primary/5 to-transparent",
  indigo:  "from-indigo-500/25 via-indigo-500/5 to-transparent",
  emerald: "from-emerald-500/25 via-emerald-500/5 to-transparent",
};

// Premium portal hero — gradient wash + clear hierarchy. Used at the top
// of /distributor and /partner so the channel partner immediately knows
// where they are and what their account looks like.
export function PortalHero({
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  status,
  actions,
  accent = "primary",
}: Props) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border bg-card",
      "shadow-sm",
    )}>
      {/* Soft top gradient wash */}
      <div className={cn(
        "absolute inset-x-0 top-0 h-48 bg-gradient-to-b pointer-events-none",
        ACCENTS[accent],
      )} />
      {/* Subtle grid overlay for a "platform" feel */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,theme(colors.border/0.5)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.border/0.5)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_60%)] pointer-events-none" />

      <div className="relative px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              {eyebrowIcon}<span>{eyebrow}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground max-w-2xl">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {status && <StatusPill status={status} />}
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: NonNullable<Props["status"]> }) {
  const cls = status.tone === "ok"
    ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
    : status.tone === "warn"
    ? "border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10"
    : "border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/10";
  return (
    <Badge variant="outline" className={cn("px-2.5 py-1 font-medium", cls)}>
      <span className={cn(
        "inline-block w-1.5 h-1.5 rounded-full mr-1.5",
        status.tone === "ok" ? "bg-emerald-500" : status.tone === "warn" ? "bg-amber-500" : "bg-rose-500",
      )} />
      {status.label}
    </Badge>
  );
}
