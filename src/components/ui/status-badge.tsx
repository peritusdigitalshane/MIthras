import { cn } from "@/lib/utils";

type StatusType = "healthy" | "warning" | "critical" | "info";

interface StatusBadgeProps {
  status: StatusType;
  label: string;
  pulse?: boolean;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  healthy: "bg-status-healthy/20 text-status-healthy border-status-healthy/30",
  warning: "bg-status-warning/20 text-status-warning border-status-warning/30",
  critical: "bg-status-critical/20 text-status-critical border-status-critical/30",
  info: "bg-status-info/20 text-status-info border-status-info/30",
};

const dotStyles: Record<StatusType, string> = {
  healthy: "bg-status-healthy",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  info: "bg-status-info",
};

export function StatusBadge({ status, label, pulse = false, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dotStyles[status],
          pulse && "animate-pulse-status"
        )}
      />
      {label}
    </span>
  );
}
