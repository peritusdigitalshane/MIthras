// In-browser animated demos for each guide. Pure CSS + SVG.
// Each demo is timed to match the guide's caption schedule. When the user
// uploads a real .mp4 or YouTube id, the player swaps these out automatically.
//
// Why this approach: zero file-size cost (only a few KB of inline DOM), no
// CORS / hosting headaches, perfect rendering on every device, and the demos
// keep working even if a real video upload fails. Real screen-recordings
// with voiceover can replace these later.

import { GuideAnimationKey, CaptionSegment } from "@/data/guides";
import "./guide-animations.css";

interface Props {
  animationKey: GuideAnimationKey;
  /** Total animation duration in seconds — drives CSS keyframe durations via inline style. */
  durationSec: number;
  /** When true, play. When false, pause/reset. Controlled by the player. */
  playing: boolean;
  /** Current playback position in seconds (used to seek; CSS animations restart on every play). */
  seekKey: number;
}

export function GuideAnimation({ animationKey, durationSec, playing, seekKey }: Props) {
  const style = {
    "--guide-duration": `${durationSec}s`,
    animationPlayState: playing ? "running" : "paused",
  } as React.CSSProperties;

  switch (animationKey) {
    case "microseg-lockdown":
      return <MicrosegAnimation style={style} key={seekKey} />;
    case "sysmon-process-tree":
      return <SysmonAnimation style={style} key={seekKey} />;
    case "monthly-pdf":
      return <PdfAnimation style={style} key={seekKey} />;
    case "dns-filtering":
      return <DnsAnimation style={style} key={seekKey} />;
  }
}

function MicrosegAnimation({ style }: { style: React.CSSProperties }) {
  return (
    <div className="ga-stage" style={style}>
      <div className="ga-window">
        <div className="ga-titlebar">
          <span className="ga-dot ga-dot--red" />
          <span className="ga-dot ga-dot--yellow" />
          <span className="ga-dot ga-dot--green" />
          <span className="ga-title">Microsegmentation · CMW Servers</span>
        </div>
        <div className="ga-body">
          <div className="ga-stat-row">
            <div className="ga-stat"><span className="ga-stat-label">Auditing</span><span className="ga-stat-value">3</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Enforcing</span><span className="ga-stat-value ga-stat-value--green">2</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Hits (24h)</span><span className="ga-stat-value ga-stat-value--amber">847</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Endpoints</span><span className="ga-stat-value">12</span></div>
          </div>

          <div className="ga-rule-card ga-rule--audit ga-anim-card-1">
            <div className="ga-rule-head">
              <span className="ga-rule-title">RDP</span>
              <span className="ga-rule-port">TCP/3389</span>
              <span className="ga-badge ga-badge--audit">Audit</span>
              <button className="ga-btn ga-btn--primary ga-anim-button">Lock Down</button>
            </div>
            <div className="ga-rule-stats">
              <div><span>Hits 7d</span><strong>184</strong></div>
              <div><span>Sources</span><strong>3</strong></div>
              <div><span>Endpoints</span><strong>2</strong></div>
              <div className="ga-spark">
                <svg viewBox="0 0 100 24" preserveAspectRatio="none">
                  <path className="ga-sparkline" d="M2 18 L17 14 L32 16 L47 10 L62 12 L77 6 L92 8" fill="none" stroke="#f59e0b" strokeWidth="1.4" />
                </svg>
              </div>
            </div>
            <div className="ga-sources">
              <span className="ga-source ga-anim-source-1">192.168.99.200 · 47</span>
              <span className="ga-source ga-anim-source-2">192.168.99.118 · 12</span>
              <span className="ga-source">10.0.4.13 · 3</span>
            </div>
            {/* Cursor that moves to click Lock Down */}
            <div className="ga-cursor ga-cursor--microseg" />
          </div>

          <div className="ga-rule-card ga-rule--locked ga-anim-card-2">
            <div className="ga-rule-head">
              <span className="ga-rule-title">RDP</span>
              <span className="ga-rule-port">TCP/3389</span>
              <span className="ga-badge ga-badge--enforce">Enforce</span>
              <span className="ga-locked-pill">Block + Allow whitelist</span>
            </div>
            <div className="ga-rule-info">Mithras-RDP-tcp-3389-block · 12 endpoints applied</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SysmonAnimation({ style }: { style: React.CSSProperties }) {
  const lines: { ts: string; depth: number; cmd: string; tone?: "warn" | "info" }[] = [
    { ts: "10:42:17", depth: 0, cmd: "winword.exe" },
    { ts: "10:42:18", depth: 1, cmd: "cmd.exe /c bitsadmin /transfer ..." },
    { ts: "10:42:18", depth: 2, cmd: "powershell.exe -ec UwBoAG8AdwAtAFcAaQ...", tone: "warn" },
    { ts: "10:42:19", depth: 3, cmd: "rundll32.exe %temp%\\setup.dll, Run", tone: "warn" },
    { ts: "10:42:19", depth: 3, cmd: "↳ dst: 45.83.220.18:443 (no PTR)", tone: "info" },
  ];
  return (
    <div className="ga-stage" style={style}>
      <div className="ga-window">
        <div className="ga-titlebar">
          <span className="ga-dot ga-dot--red" />
          <span className="ga-dot ga-dot--yellow" />
          <span className="ga-dot ga-dot--green" />
          <span className="ga-title">Process Telemetry · acme-fileserver01</span>
        </div>
        <div className="ga-body ga-body--terminal">
          <div className="ga-stat-row">
            <div className="ga-stat"><span className="ga-stat-label">Total (24h)</span><span className="ga-stat-value">4,127</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Process</span><span className="ga-stat-value">2,318</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Network</span><span className="ga-stat-value ga-stat-value--amber">1,402</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Endpoints</span><span className="ga-stat-value">18</span></div>
          </div>
          <div className="ga-terminal">
            {lines.map((line, i) => (
              <div
                key={i}
                className={`ga-term-line ga-anim-term-${i + 1} ${line.tone === "warn" ? "ga-term-line--warn" : ""} ${line.tone === "info" ? "ga-term-line--info" : ""}`}
                style={{ paddingLeft: `${line.depth * 16}px` }}
              >
                <span className="ga-term-ts">{line.ts}</span>
                <span className="ga-term-cmd">{line.cmd}</span>
              </div>
            ))}
            <div className="ga-flag ga-anim-flag">SUSPICIOUS · IOC match · SHA256 a3f4...c821</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfAnimation({ style }: { style: React.CSSProperties }) {
  return (
    <div className="ga-stage" style={style}>
      <div className="ga-window">
        <div className="ga-titlebar">
          <span className="ga-dot ga-dot--red" />
          <span className="ga-dot ga-dot--yellow" />
          <span className="ga-dot ga-dot--green" />
          <span className="ga-title">Customer Reports · Acme Co.</span>
        </div>
        <div className="ga-body">
          <div className="ga-pdf-scene">
            <div className="ga-calendar ga-anim-calendar">
              <div className="ga-cal-head">MAY 2026</div>
              <div className="ga-cal-grid">
                {Array.from({ length: 31 }).map((_, i) => (
                  <span key={i} className={`ga-cal-day ${i === 0 ? "ga-cal-day--active" : ""}`}>{i + 1}</span>
                ))}
              </div>
            </div>
            <div className="ga-arrow ga-anim-arrow">→</div>
            <div className="ga-pdf-doc ga-anim-pdf">
              <div className="ga-pdf-brand">MITHRAS · MAY 2026</div>
              <div className="ga-pdf-org">Acme Co. · Monthly security report</div>
              <div className="ga-pdf-exec">
                <strong>AI EXECUTIVE SUMMARY</strong>
                <p>Defender posture across 24 endpoints remained strong this month. Two minor threats were detected and remediated within the hour…</p>
              </div>
              <div className="ga-pdf-kpis">
                <div><span>Endpoints</span><strong>24</strong></div>
                <div><span>Threats</span><strong>2</strong></div>
                <div><span>Open vulns</span><strong>3</strong></div>
                <div><span>Incidents</span><strong>0</strong></div>
              </div>
            </div>
            <div className="ga-arrow ga-anim-arrow-2">→</div>
            <div className="ga-mail ga-anim-mail">
              <div className="ga-mail-head">📧 owner@acme.com</div>
              <div className="ga-mail-body">
                Subject: Acme Co. monthly security report — May 2026
                <br /><span style={{ opacity: 0.6 }}>📎 acme-monthly-2026-05-01.pdf (3.2 KB)</span>
              </div>
              <span className="ga-badge ga-badge--enforce">Sent</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DnsAnimation({ style }: { style: React.CSSProperties }) {
  return (
    <div className="ga-stage" style={style}>
      <div className="ga-window">
        <div className="ga-titlebar">
          <span className="ga-dot ga-dot--red" />
          <span className="ga-dot ga-dot--yellow" />
          <span className="ga-dot ga-dot--green" />
          <span className="ga-title">DNS Filtering · CMW Servers</span>
        </div>
        <div className="ga-body">
          <div className="ga-dns-row ga-anim-dns-1">
            <div className="ga-dns-source">
              <div className="ga-dns-host">malicious.example.com</div>
              <div className="ga-dns-meta">acme-fileserver01 · 10:42:08</div>
            </div>
            <div className="ga-dns-arrow">→</div>
            <div className="ga-dns-resolver">
              dns.mithras.com.au
              <span className="ga-dns-step">policy check</span>
            </div>
            <div className="ga-dns-arrow">→</div>
            <div className="ga-dns-result ga-dns-result--block">NXDOMAIN<br /><small>category: malware</small></div>
          </div>

          <div className="ga-dns-row ga-anim-dns-2">
            <div className="ga-dns-source">
              <div className="ga-dns-host">app.corp.local</div>
              <div className="ga-dns-meta">acme-laptop15 · 10:42:11</div>
            </div>
            <div className="ga-dns-arrow">↘</div>
            <div className="ga-dns-resolver ga-dns-resolver--internal">
              NRPT: *.corp.local
              <span className="ga-dns-step">→ 192.168.1.10</span>
            </div>
            <div className="ga-dns-arrow">→</div>
            <div className="ga-dns-result ga-dns-result--allow">10.13.4.21<br /><small>internal AD</small></div>
          </div>

          <div className="ga-dns-row ga-anim-dns-3">
            <div className="ga-dns-source">
              <div className="ga-dns-host">github.com</div>
              <div className="ga-dns-meta">acme-dev04 · 10:42:14</div>
            </div>
            <div className="ga-dns-arrow">→</div>
            <div className="ga-dns-resolver">
              dns.mithras.com.au
              <span className="ga-dns-step">→ Cloudflare Family</span>
            </div>
            <div className="ga-dns-arrow">→</div>
            <div className="ga-dns-result ga-dns-result--allow">140.82.121.4<br /><small>forwarded</small></div>
          </div>

          <div className="ga-dns-stats ga-anim-dns-stats">
            <div className="ga-stat"><span className="ga-stat-label">Queries (24h)</span><span className="ga-stat-value">147,328</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Blocked</span><span className="ga-stat-value ga-stat-value--red">412</span></div>
            <div className="ga-stat"><span className="ga-stat-label">Unique domains</span><span className="ga-stat-value">2,891</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
