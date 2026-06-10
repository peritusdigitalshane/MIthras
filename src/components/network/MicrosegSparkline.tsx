import { cn } from "@/lib/utils";

interface MicrosegSparklineProps {
  values: number[];
  className?: string;
  color?: string;
}

export function MicrosegSparkline({
  values,
  className,
  color = "currentColor",
}: MicrosegSparklineProps) {
  const w = 100;
  const h = 28;
  const pad = 2;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    return { x, y, v };
  });

  const linePath =
    points.length > 0
      ? `M ${points[0].x} ${points[0].y} ${points
          .slice(1)
          .map((p) => `L ${p.x} ${p.y}`)
          .join(" ")}`
      : "";

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`
      : "";

  const total = values.reduce((s, v) => s + v, 0);

  if (total === 0) {
    return (
      <div className={cn("h-7 flex items-center text-[10px] text-muted-foreground/60", className)}>
        no hits in last 7 days
      </div>
    );
  }

  return (
    <div className={cn("flex items-end gap-2", className)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 overflow-visible" style={{ color }}>
        <path d={areaPath} fill={color} opacity={0.15} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={p.v > 0 ? 1.5 : 0}
            fill={color}
          >
            <title>
              {p.v} hit{p.v === 1 ? "" : "s"}, {6 - i} day{6 - i === 1 ? "" : "s"} ago
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
