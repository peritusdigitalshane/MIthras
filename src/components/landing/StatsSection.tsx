// Trust strip — replaces the previous aspirational "99.9% uptime / 50K+ endpoints"
// numbers (which we couldn't honestly claim). Shows the security surface the
// platform covers natively: Windows + Linux + macOS endpoints, Microsoft
// Defender, Active Directory / Group Policy, and WordPress sites.

export function StatsSection() {
  return (
    <section className="py-14 border-y border-border/40 bg-muted/20">
      <div className="container mx-auto px-6">
        <p className="text-center text-xs font-medium tracking-[0.18em] uppercase text-muted-foreground mb-8">
          Native coverage for the tools you already run
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 items-center">
          {COVERAGE.map((c) => (
            <CoverageItem key={c.label} {...c} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface Coverage { label: string; sub: string; logoSvg: React.ReactNode; }

const COVERAGE: Coverage[] = [
  {
    label: "Windows",
    sub: "Server 2012+ / 10 / 11",
    logoSvg: <WindowsMark />,
  },
  {
    label: "Linux",
    sub: "Ubuntu / RHEL / Debian",
    logoSvg: <LinuxMark />,
  },
  {
    label: "macOS",
    sub: "On the roadmap",
    logoSvg: <AppleMark />,
  },
  {
    label: "MS Defender",
    sub: "Posture + ASR + policy",
    logoSvg: <DefenderMark />,
  },
  {
    label: "Group Policy",
    sub: "No AD required",
    logoSvg: <GpoMark />,
  },
  {
    label: "WordPress",
    sub: "Site audit + protect",
    logoSvg: <WordPressMark />,
  },
];

function CoverageItem({ label, sub, logoSvg }: Coverage) {
  return (
    <div className="flex flex-col items-center text-center group">
      <div className="h-12 flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors mb-2">
        {logoSvg}
      </div>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

// Inline SVG marks - generic geometric forms, brand-safe (no trademarked logos copied).
function WindowsMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
      <path d="M2 4l9-1.3v9.3H2V4zm10-1.4L23 1v11.7H12V2.6zM2 13h9v9.3L2 21V13zm10 0h11v10l-11-1.5V13z" />
    </svg>
  );
}
function LinuxMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
      <path d="M12 1.5c-2.7 0-4.6 2.2-4.6 5 0 .6.1 1.2.3 1.7-.6.4-1 1-1 1.7-.4 1.7-2 3.7-2 5.5 0 .9.3 1.7.9 2.3.4-.4.9-.7 1.5-.7-.2-.4-.3-.9-.3-1.4 0-1.5 1-3.1 1.7-3.8.5-.5.7-.4 1.1-1.6.5-.1 1.1.1 1.4.5.6.4 1.5.6 2.4.6 1 0 1.9-.3 2.7-.7.4-.6 1.2-.8 1.9-.4.5 1.2.7 1.1 1.2 1.6.7.7 1.7 2.3 1.7 3.8 0 .5-.1 1-.3 1.4.6 0 1.1.3 1.5.7.6-.6.9-1.4.9-2.3 0-1.8-1.6-3.8-2-5.5 0-.7-.5-1.3-1-1.7.2-.5.3-1.1.3-1.7 0-2.8-1.9-5-4.6-5zm-1.8 5.4c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1zm3.6 0c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1zM12 9.7c-.7 0-1.2.4-1.2.9 0 .4.5.8 1.2.8s1.2-.4 1.2-.8c0-.5-.5-.9-1.2-.9zm-7.4 8.7c-.3 0-.7.2-1 .6-.7.8-.4 2.2.5 2.7.4.2 1.7.5 2.4 1 .7.4 1.4 1 2 1.1 1 .2 2.4-.2 2.4-.9 0-.4-.5-.6-1-.9-.7-.5-1.3-1.4-1.7-2.3-.3-.5-1.4-1.2-2.4-1.3-.4-.1-.7 0-1.2 0zm14.8 0c-.5 0-.8-.1-1.2 0-1 .1-2.1.8-2.4 1.3-.4.9-1 1.8-1.7 2.3-.5.3-1 .5-1 .9 0 .7 1.4 1.1 2.4.9.6-.1 1.3-.7 2-1.1.7-.5 2-.8 2.4-1 .9-.5 1.2-1.9.5-2.7-.3-.4-.7-.6-1-.6z" />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
      <path d="M17.6 13a4.2 4.2 0 012-3.5 4.3 4.3 0 00-3.4-1.8c-1.4 0-2.8.8-3.5.8-.8 0-1.9-.8-3.1-.8a4.5 4.5 0 00-3.8 2.3c-1.6 2.8-.4 7 1.2 9.2.8 1.1 1.7 2.4 3 2.3 1.2-.1 1.6-.8 3-.8 1.4 0 1.8.8 3.1.8 1.3 0 2.1-1.1 2.9-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.7-1-2.7-3.7zm-2.4-6.7a4 4 0 001-3 4 4 0 00-2.6 1.4 3.7 3.7 0 00-1 2.9 3.3 3.3 0 002.6-1.3z" />
    </svg>
  );
}
function DefenderMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M12 2L4 5v6c0 4.8 3.2 9.1 8 11 4.8-1.9 8-6.2 8-11V5l-8-3z" />
      <path d="M8.5 12l2.5 2.5L15.5 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GpoMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" strokeLinecap="round" />
      <circle cx="7" cy="14" r="1" fill="currentColor" />
      <path d="M10 14h8" strokeLinecap="round" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
      <path d="M10 17h6" strokeLinecap="round" />
    </svg>
  );
}
function WordPressMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 1.5c4.7 0 8.5 3.8 8.5 8.5 0 .8-.1 1.6-.4 2.4l-3.5-9.6c1.7.9 3 2.2 3.9 3.7zM3.5 12c0-1.5.4-2.9 1.1-4.1L8.5 19c-3-1.4-5-4.4-5-7zm6.4 7.5L13.6 8 16.4 19c-1.2.4-2.5.6-3.9.6-.9 0-1.7-.1-2.6-.1zM18 18l-3-9.3c.4-.6.6-1.4.6-2.3 0-.8-.3-1.4-.6-1.9-.4-.5-.8-.9-.8-1.4 0-.5.4-1 .9-1 .1 0 .2 0 .3.1A8.5 8.5 0 0118 18z" />
    </svg>
  );
}
