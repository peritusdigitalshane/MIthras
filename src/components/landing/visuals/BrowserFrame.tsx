import { Lock } from "lucide-react";

/**
 * Chrome-style browser frame for embedding mock platform screens on the
 * landing pages. Looks like a real browser, dark by default so it sits in
 * the existing landing aesthetic without a hard chrome edge.
 *
 * url — what to render in the address bar (no scheme; we prepend the lock + https://)
 */
export function BrowserFrame({
  url,
  children,
  className = "",
  tilt: _tilt = false,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
  /**
   * No-op as of 2026-06-16. The prop used to apply
   * `perspective(2400px) rotateX(4deg) rotateY(-2deg)` to lean the frame
   * away from the viewer, but the rotation made the screenshot's edges
   * visibly NOT-LEVEL with the FrameLabel text above it on landing pages
   * (users reported the visual misalignment). Kept as a prop so every
   * existing call site stays valid; the value is intentionally ignored.
   * Delete the prop later if you want to retire the cosmetic API.
   */
  tilt?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border border-border/60 bg-card/70 backdrop-blur shadow-2xl shadow-primary/10 overflow-hidden ${className}`}
    >
      {/* Chrome bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border/40 bg-card/80">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-background/60 border border-border/40 text-[11px] font-mono text-muted-foreground max-w-full truncate">
            <Lock className="h-2.5 w-2.5 text-emerald-400 flex-shrink-0" />
            <span className="truncate">{url}</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      {/* Content */}
      <div className="bg-background/50">{children}</div>
    </div>
  );
}
