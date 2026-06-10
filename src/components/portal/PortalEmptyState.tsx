import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  primaryAction?: { label: string; onClick?: () => void; href?: string };
  secondaryAction?: { label: string; onClick?: () => void; href?: string };
  // Visual accent for the icon halo.
  accent?: "primary" | "indigo" | "emerald" | "amber";
  className?: string;
}

const HALO: Record<NonNullable<Props["accent"]>, string> = {
  primary: "bg-primary/15 text-primary ring-primary/20",
  indigo:  "bg-indigo-500/15 text-indigo-500 ring-indigo-500/20",
  emerald: "bg-emerald-500/15 text-emerald-500 ring-emerald-500/20",
  amber:   "bg-amber-500/15 text-amber-500 ring-amber-500/20",
};

export function PortalEmptyState({
  icon, title, description, primaryAction, secondaryAction, accent = "primary", className,
}: Props) {
  const Wrapper = ({ children, action }: { children: ReactNode; action?: Props["primaryAction"] }) => {
    if (action?.href) return <Button asChild><a href={action.href}>{children}</a></Button>;
    return <Button onClick={action?.onClick}>{children}</Button>;
  };
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="flex flex-col items-center justify-center text-center py-12 px-6 space-y-4">
        <div className={cn("inline-flex h-14 w-14 items-center justify-center rounded-2xl ring-1", HALO[accent])}>
          {icon}
        </div>
        <div className="space-y-1.5 max-w-md">
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {primaryAction && (
              <Wrapper action={primaryAction}>{primaryAction.label}</Wrapper>
            )}
            {secondaryAction && (
              secondaryAction.href
                ? <Button variant="ghost" asChild><a href={secondaryAction.href}>{secondaryAction.label}</a></Button>
                : <Button variant="ghost" onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
