import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
  // Optional delta vs previous period (positive = up).
  deltaPercent?: number | null;
  // For "Wholesale MRR" type stats where higher = better;
  // for "Outage minutes" type stats where higher = worse, set positive_is_bad
  positiveIsBad?: boolean;
}

// Premium stat card with optional delta. Reads as a "primary number"
// dominated card — the value should be the headline of the card.
export function PortalStatCard({
  label, value, hint, icon, loading, deltaPercent, positiveIsBad = false,
}: Props) {
  return (
    <Card className="relative overflow-hidden group hover:border-primary/30 transition-colors">
      {/* Subtle hover sheen */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs uppercase tracking-wider font-medium">{label}</span>
          {icon && <span className="opacity-60 group-hover:opacity-100 transition-opacity">{icon}</span>}
        </div>
        <div className="flex items-baseline gap-3">
          {loading
            ? <Skeleton className="h-9 w-28" />
            : <div className="text-3xl font-bold tabular-nums tracking-tight">{value}</div>
          }
          {!loading && typeof deltaPercent === "number" && <Delta percent={deltaPercent} positiveIsBad={positiveIsBad} />}
        </div>
        {hint && <p className="text-xs text-muted-foreground leading-snug">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Delta({ percent, positiveIsBad }: { percent: number; positiveIsBad: boolean }) {
  const isZero = Math.abs(percent) < 0.5;
  const up = percent > 0;
  // Good direction depends on the stat semantics.
  const good = isZero ? null : (up !== positiveIsBad);
  const cls = isZero
    ? "text-muted-foreground border-border bg-muted/40"
    : good
      ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
      : "text-rose-600 dark:text-rose-400 border-rose-500/40 bg-rose-500/10";
  const Icon = isZero ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-xs font-medium tabular-nums", cls)}>
      <Icon className="h-3 w-3" />
      {Math.abs(percent).toFixed(0)}%
    </span>
  );
}
