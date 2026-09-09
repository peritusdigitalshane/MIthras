// Guide catalog. Each guide can resolve to one of three players:
//   1. videoUrl (mp4) - self-hosted in /public/guides/<slug>.mp4
//   2. youtubeId    - embedded YouTube iframe
//   3. animationKey - falls back to the CSS demo registered in GuideAnimations
// The page picks the first available source in that order.

import React from "react";

export type GuideAnimationKey =
  | "microseg-lockdown"
  | "sysmon-process-tree"
  | "monthly-pdf"
  | "dns-filtering";

export interface CaptionSegment {
  /** Start time of this caption in seconds. */
  startSec: number;
  /** End time of this caption in seconds. */
  endSec: number;
  /** Narrator copy. */
  text: string;
}

export interface Guide {
  slug: string;
  title: string;
  oneLiner: string;
  category: "Microsegmentation" | "EDR" | "Reports" | "DNS" | "Onboarding";
  durationSec: number;
  /** JSX component used as the card thumbnail. */
  Thumbnail: React.FC;
  /** Optional self-hosted MP4 path. */
  videoUrl?: string;
  /** Optional YouTube video id (preferred — adaptive streaming + no host bandwidth). */
  youtubeId?: string;
  /** CSS demo to fall back to when no video is uploaded yet. */
  animationKey: GuideAnimationKey;
  captions: CaptionSegment[];
}

// Thumbnail components — JSX SVG, fully type-safe, no innerHTML.
const ThumbMicroseg: React.FC = () => (
  <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="thumb-microseg-g1" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#00C4AB" stopOpacity="0.25" />
        <stop offset="1" stopColor="#00C4AB" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="#0f172a" />
    <rect width="320" height="180" fill="url(#thumb-microseg-g1)" />
    <g transform="translate(28,30)" fill="#00C4AB">
      <rect width="120" height="14" rx="3" opacity="0.9" />
      <rect y="22" width="80" height="8" rx="2" opacity="0.5" />
    </g>
    <g transform="translate(28,80)">
      <rect width="80" height="60" rx="6" fill="#1e293b" stroke="#00C4AB" strokeOpacity="0.4" />
      <text x="40" y="32" textAnchor="middle" fill="#00C4AB" fontFamily="system-ui" fontSize="11" fontWeight="600">RDP</text>
      <text x="40" y="48" textAnchor="middle" fill="#94a3b8" fontFamily="system-ui" fontSize="9">Audit</text>
      <rect x="90" width="80" height="60" rx="6" fill="#1e293b" stroke="#dc2626" strokeOpacity="0.6" />
      <text x="130" y="32" textAnchor="middle" fill="#fca5a5" fontFamily="system-ui" fontSize="11" fontWeight="600">WinRM</text>
      <text x="130" y="48" textAnchor="middle" fill="#fca5a5" fontFamily="system-ui" fontSize="9">Enforce</text>
      <rect x="180" width="80" height="60" rx="6" fill="#1e293b" stroke="#22c55e" strokeOpacity="0.6" />
      <text x="220" y="32" textAnchor="middle" fill="#86efac" fontFamily="system-ui" fontSize="11" fontWeight="600">SMB</text>
      <text x="220" y="48" textAnchor="middle" fill="#86efac" fontFamily="system-ui" fontSize="9">Locked</text>
    </g>
  </svg>
);

const ThumbSysmon: React.FC = () => (
  <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <rect width="320" height="180" fill="#0f172a" />
    <g transform="translate(28,30)" fontFamily="ui-monospace,monospace" fontSize="11">
      <text fill="#94a3b8">[2026-05-31 10:42:17] cmd.exe</text>
      <text y="20" fill="#94a3b8">  └─ powershell.exe -ec UwB0AHIAaQ...</text>
      <text y="40" fill="#fca5a5" fontWeight="600">  └─ rundll32.exe</text>
      <text y="58" fill="#94a3b8" fontSize="9">     SHA256: a3f4...c821</text>
      <text y="76" fill="#94a3b8" fontSize="9">     dst: 45.83.220.18:443</text>
    </g>
    <g transform="translate(220,100)">
      <rect width="74" height="22" rx="11" fill="#dc2626" fillOpacity="0.18" stroke="#dc2626" strokeOpacity="0.5" />
      <text x="37" y="15" textAnchor="middle" fill="#fca5a5" fontFamily="system-ui" fontSize="10" fontWeight="600">SUSPICIOUS</text>
    </g>
  </svg>
);

const ThumbPdf: React.FC = () => (
  <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <rect width="320" height="180" fill="#0f172a" />
    <g transform="translate(110,28)">
      <rect width="100" height="124" rx="6" fill="#f8fafc" stroke="#00C4AB" strokeOpacity="0.4" />
      <rect x="14" y="14" width="30" height="6" rx="1" fill="#00C4AB" />
      <rect x="14" y="32" width="72" height="3" rx="1" fill="#0f172a" fillOpacity="0.5" />
      <rect x="14" y="38" width="56" height="3" rx="1" fill="#0f172a" fillOpacity="0.4" />
      <rect x="14" y="54" width="34" height="20" rx="3" fill="#00C4AB" fillOpacity="0.18" />
      <rect x="52" y="54" width="34" height="20" rx="3" fill="#00C4AB" fillOpacity="0.18" />
      <rect x="14" y="80" width="72" height="3" rx="1" fill="#0f172a" fillOpacity="0.3" />
      <rect x="14" y="86" width="62" height="3" rx="1" fill="#0f172a" fillOpacity="0.3" />
      <rect x="14" y="92" width="68" height="3" rx="1" fill="#0f172a" fillOpacity="0.3" />
      <text x="14" y="115" fontFamily="system-ui" fontSize="6" fill="#00C4AB">MITHRAS · MAY 2026</text>
    </g>
  </svg>
);

const ThumbDns: React.FC = () => (
  <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <rect width="320" height="180" fill="#0f172a" />
    <g transform="translate(28,40)" fontFamily="ui-monospace,monospace" fontSize="11">
      <text fill="#94a3b8">malicious.example.com</text>
      <text y="18" fill="#94a3b8" fontSize="9" opacity="0.7">→ Mithras resolver</text>
      <g transform="translate(180,-2)">
        <rect width="80" height="22" rx="11" fill="#dc2626" fillOpacity="0.18" stroke="#dc2626" strokeOpacity="0.5" />
        <text x="40" y="15" textAnchor="middle" fill="#fca5a5" fontFamily="system-ui" fontSize="10" fontWeight="600">NXDOMAIN</text>
      </g>
    </g>
    <g transform="translate(28,90)" fontFamily="ui-monospace,monospace" fontSize="11">
      <text fill="#94a3b8">app.corp.local</text>
      <text y="18" fill="#94a3b8" fontSize="9" opacity="0.7">→ 192.168.1.10 (internal)</text>
      <g transform="translate(220,-2)">
        <rect width="60" height="22" rx="11" fill="#22c55e" fillOpacity="0.18" stroke="#22c55e" strokeOpacity="0.5" />
        <text x="30" y="15" textAnchor="middle" fill="#86efac" fontFamily="system-ui" fontSize="10" fontWeight="600">ALLOWED</text>
      </g>
    </g>
  </svg>
);

export const GUIDES: Guide[] = [
  {
    slug: "microsegmentation-lockdown",
    title: "Lock down a port in one click",
    oneLiner:
      "Microsegmentation: watch traffic patterns, then turn audit into enforce with a single button.",
    category: "Microsegmentation",
    durationSec: 78,
    Thumbnail: ThumbMicroseg,
    animationKey: "microseg-lockdown",
    captions: [
      { startSec: 0, endSec: 6, text: "Microsegmentation in Mithras starts with a learn-mode rule. The agent watches every inbound connection to that service and sends it back to the platform." },
      { startSec: 6, endSec: 14, text: "Each rule card shows the last 24 hours and 7 days of traffic, the unique sources, and which endpoints are reporting in." },
      { startSec: 14, endSec: 22, text: "Top sources are listed at the bottom — click a source to whitelist it before you lock the port down." },
      { startSec: 22, endSec: 32, text: "When you're happy with what you see, click Lock Down. The platform pushes a Windows Firewall block rule plus an allow-rule scoped to your whitelisted sources." },
      { startSec: 32, endSec: 44, text: "Every endpoint in the assigned group picks it up on the next policy pass — usually under fifteen minutes." },
      { startSec: 44, endSec: 56, text: "The rule moves to the Locked Down section, the sparkline keeps recording attempts, and you can revert at any time with one click." },
      { startSec: 56, endSec: 78, text: "That's a complete kill chain for any inbound service — observe, decide, enforce. Without buying CrowdStrike, without writing GPO scripts, without learning a new firewall." },
    ],
  },
  {
    slug: "sysmon-process-tree",
    title: "See every process — including the suspicious ones",
    oneLiner:
      "Real EDR telemetry: process trees, command lines, SHA256 hashes, network destinations. From every endpoint.",
    category: "EDR",
    durationSec: 72,
    Thumbnail: ThumbSysmon,
    animationKey: "sysmon-process-tree",
    captions: [
      { startSec: 0, endSec: 8, text: "Mithras installs Sysmon on every endpoint with a tuned configuration. You get process creates, network connects, and file creates streaming into the platform on every agent heartbeat — every 30 seconds." },
      { startSec: 8, endSec: 18, text: "The Process Telemetry view shows the entire fleet's activity. Filter by event type, search by command line, hash, image, or destination IP." },
      { startSec: 18, endSec: 30, text: "Each row tells you the parent process, the user, the integrity level, the destination of any network connection, and the SHA256 hash of the binary." },
      { startSec: 30, endSec: 42, text: "When something stands out — say a powershell child of Word — click into it. You'll see the full command line, the encoded payload, and any outbound connections from the same process." },
      { startSec: 42, endSec: 54, text: "Drop the SHA256 into the IOC library and the next time it shows up anywhere in your fleet, you get an alert." },
      { startSec: 54, endSec: 72, text: "Telemetry retention defaults to ninety days on partitioned tables. Indexes are tuned for the queries an analyst actually runs — by hash, by destination, by image path." },
    ],
  },
  {
    slug: "monthly-pdf-report",
    title: "Send your customer a polished monthly report",
    oneLiner:
      "Auto-generated PDF on the 1st of every month, AI exec summary, emailed to whoever you nominate.",
    category: "Reports",
    durationSec: 66,
    Thumbnail: ThumbPdf,
    animationKey: "monthly-pdf",
    captions: [
      { startSec: 0, endSec: 8, text: "Monthly reports auto-generate on the first of every month. The cron pulls the prior month's posture data and produces both an HTML version and a PDF." },
      { startSec: 8, endSec: 20, text: "The PDF starts with an AI-written executive summary tuned for a non-technical reader. Then a KPI grid: endpoints, threats, incidents, critical vulnerabilities." },
      { startSec: 20, endSec: 32, text: "Incidents are listed with severity and status. Top software in the fleet shows what your customer is actually running." },
      { startSec: 32, endSec: 44, text: "Recipients are managed per customer. Add the owner, IT manager, and compliance lead — each one opts into monthly, weekly, or quarterly delivery." },
      { startSec: 44, endSec: 56, text: "When the report finishes generating, the platform ships it via SMTP to every recipient as a PDF attachment. Branded, dated, professional." },
      { startSec: 56, endSec: 66, text: "You can also generate ad-hoc reports for any custom period, or hit the Send button to re-deliver an existing report on demand." },
    ],
  },
  {
    slug: "dns-filtering",
    title: "Block malicious DNS without breaking your customer's internal network",
    oneLiner:
      "Cloud-hosted DoH resolver with per-customer policy, plus split-DNS for internal suffixes.",
    category: "DNS",
    durationSec: 84,
    Thumbnail: ThumbDns,
    animationKey: "dns-filtering",
    captions: [
      { startSec: 0, endSec: 10, text: "DNS filtering in Mithras works like Cisco Umbrella for DNS-layer security — but multi-tenant by design and tied directly into your existing policy console." },
      { startSec: 10, endSec: 22, text: "Endpoints route DNS to a Mithras-hosted DoH resolver. Each query carries the customer's unique ID in the URL path, so the resolver applies the right policy." },
      { startSec: 22, endSec: 36, text: "Malicious domains return NXDOMAIN — blocked before the endpoint ever connects. The decision is logged with timestamp, endpoint, and reason." },
      { startSec: 36, endSec: 50, text: "Internal suffixes are the tricky part most cloud DNS products handle badly. In Mithras, you add each internal scope — corp dot local, an AD reverse-DNS zone, whatever you need." },
      { startSec: 50, endSec: 64, text: "The agent pushes those as Windows NRPT rules. Internal queries resolve directly via the customer's own DNS forwarders. External queries route through us." },
      { startSec: 64, endSec: 76, text: "Insights show you what's actually being blocked, which endpoints are talking to what, and where the noisy domains are." },
      { startSec: 76, endSec: 84, text: "DNS-layer protection plus split DNS. The endpoint never knows it's being filtered. The customer's AD never breaks." },
    ],
  },
];
