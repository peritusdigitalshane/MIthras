import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

interface GlossaryEntry {
  id: string;                  // URL anchor (matches /glossary#<id>)
  term: string;
  oneLine: string;
  whenSeen: string;
  longer: React.ReactNode;
  category: "Concepts" | "Modes & states" | "Threats & incidents" | "Policy & rules" | "Identity & auth" | "Telemetry";
}

// Single source of truth for help-text terminology. HelpHint and PageHelp
// components both deep-link here via /glossary#<id> anchors.
const ENTRIES: GlossaryEntry[] = [
  // ── Concepts ───────────────────────────────────────────────────────────
  {
    id: "microsegmentation",
    term: "Microsegmentation",
    oneLine: "Per-endpoint allowlist of network traffic.",
    whenSeen: "/microsegmentation, EndpointDetail",
    category: "Concepts",
    longer: (
      <>
        <p>
          Microsegmentation builds a firewall rule set <em>per endpoint</em> based on the traffic each
          machine actually handles. The agent watches every connection for a learning window
          (usually 7 days), then you click <b>Enforce</b> and anything not seen during learning
          gets blocked.
        </p>
        <p>
          Think of it as Windows Firewall, but with rules learned from real traffic instead of
          hand-written. Each endpoint gets its own private rule set so changes on one machine
          never affect another.
        </p>
      </>
    ),
  },
  {
    id: "app-whitelisting",
    term: "Application whitelisting",
    oneLine: "Block any process whose binary isn't on the allow-list.",
    whenSeen: "/app-whitelisting, EndpointDetail",
    category: "Concepts",
    longer: (
      <>
        <p>
          Mithras' AppWhitelist watches process launches via WMI. In <b>audit</b> mode it logs
          every binary that runs; in <b>enforce</b> mode it terminates anything whose SHA-256 hash,
          Authenticode publisher, or path glob doesn't match a whitelist rule.
        </p>
        <p>
          Works on every Windows SKU including EOL boxes (Win7/8.1/Server 2012 R2) — the
          differentiator vs CrowdStrike/Huntress for SMB legacy fleets. On Win10/11 Enterprise +
          Server 2016+, <b>WDAC</b> provides kernel-level enforcement for the same idea.
        </p>
      </>
    ),
  },
  {
    id: "wdac",
    term: "WDAC (Windows Defender Application Control)",
    oneLine: "Microsoft's kernel-level application allowlisting.",
    whenSeen: "/policies → Application Control, EndpointDetail",
    category: "Concepts",
    longer: (
      <>
        <p>
          WDAC is Microsoft's built-in code-integrity engine. It allows or denies executable
          code at boot/load time inside the Windows kernel, which means a user-mode program
          can't switch it off — even if it has admin rights.
        </p>
        <p>
          Pros: zero race window, no agent to kill. Cons: only available on Win10/11 Enterprise,
          Server 2016+, and a few specific SKUs — not Pro, Home, or older Server. Mithras applies
          WDAC where supported and falls back to AppWhitelist's WMI watcher elsewhere.
        </p>
      </>
    ),
  },
  {
    id: "sysmon",
    term: "Sysmon",
    oneLine: "Microsoft Sysinternals' process + network + file telemetry sensor.",
    whenSeen: "/telemetry, /threat-hunting",
    category: "Telemetry",
    longer: (
      <>
        <p>
          Sysmon is a kernel driver that logs detailed process events (creation, network
          connections, image loads, named pipes) to the Windows event log. Mithras forwards these
          to the platform so analysts can hunt across the fleet.
        </p>
        <p>
          The agent ships ~500 events per push every few minutes; large clusters can generate
          tens of thousands per hour per endpoint.
        </p>
      </>
    ),
  },
  {
    id: "asr",
    term: "ASR (Attack Surface Reduction)",
    oneLine: "Microsoft Defender's hardening rules — block common attack patterns.",
    whenSeen: "Defender policy editor",
    category: "Policy & rules",
    longer: (
      <>
        <p>
          ASR is a Defender feature with 16+ specific rules like <i>"block Office child processes
          spawning EXE"</i> or <i>"block process creation from PsExec/WMI"</i>. Each rule can be
          set to Block, Audit (log only), or Off.
        </p>
        <p>
          Mithras' Defender policy editor exposes them as toggles. ASR is push-only today — the
          agent applies them but doesn't report back which are active.
        </p>
      </>
    ),
  },

  // ── Modes & states ────────────────────────────────────────────────────
  {
    id: "microseg-learning",
    term: "Learning mode",
    oneLine: "Watch, log, never block.",
    whenSeen: "Microsegmentation state badge, AppWhitelist mode badge",
    category: "Modes & states",
    longer: (
      <>
        <p>The agent records traffic / process launches but applies <b>no</b> firewall changes
        or process kills. Use it to build a baseline of normal behaviour over ~7 days.</p>
        <p>Safe to leave running indefinitely — telemetry is the only side effect.</p>
      </>
    ),
  },
  {
    id: "microseg-enforcing",
    term: "Enforce mode",
    oneLine: "Block anything not observed during learning.",
    whenSeen: "Microsegmentation state badge, AppWhitelist mode badge",
    category: "Modes & states",
    longer: (
      <>
        <p>
          The agent installs Windows Firewall block rules for every port / protocol observed
          during the learning window (microseg) or terminates processes whose binary doesn't
          match a whitelist rule (AppWhitelist).
        </p>
        <p>
          Idempotent — safely re-runnable. Stop any time via the dashboard; the agent will
          remove its rules on the next policy pass.
        </p>
      </>
    ),
  },
  {
    id: "audit-mode",
    term: "Audit mode (generic)",
    oneLine: "Watch + log, do not enforce.",
    whenSeen: "Defender policy, WDAC, AppWhitelist, firewall rules",
    category: "Modes & states",
    longer: (
      <p>
        Most engines on the platform have an Audit mode that records what <em>would</em> have
        been blocked without actually blocking. Use it to verify a policy is correct before
        flipping to enforce.
      </p>
    ),
  },

  // ── Threats & incidents ───────────────────────────────────────────────
  {
    id: "severity",
    term: "Severity (Severe / High / Moderate / Low / Unknown)",
    oneLine: "Defender's threat severity scale.",
    whenSeen: "Threats, Incidents, Alerts, EndpointDetail",
    category: "Threats & incidents",
    longer: (
      <>
        <p>Mithras inherits Microsoft Defender's 5-level scale:</p>
        <ul>
          <li><b>Severe</b> — confirmed malware, ransomware, worm</li>
          <li><b>High</b> — hacktools, exploit kits, RATs</li>
          <li><b>Moderate</b> — PUA, adware, monitoring tools</li>
          <li><b>Low</b> — misleading apps, low-confidence detections</li>
          <li><b>Unknown</b> — needs triage (severity couldn't be determined)</li>
        </ul>
        <p><b>Severe and High auto-open incidents</b> with SLA timers (1h / 4h respectively).</p>
        <p>
          Note: <b>alerts</b> use lowercase critical/high/medium/low — Defender threats use
          Title-case. They map: critical → Severe, high → High, etc.
        </p>
      </>
    ),
  },
  {
    id: "incident-kind",
    term: "Incident kind",
    oneLine: "What spawned the incident.",
    whenSeen: "Incidents",
    category: "Threats & incidents",
    longer: (
      <>
        <ul>
          <li><b>threat</b> — Severe/High Defender threat on an endpoint</li>
          <li><b>alert</b> — Critical/High alert (M365, ransomware indicator, etc.)</li>
          <li><b>posture_drift</b> — endpoint fell out of policy</li>
          <li><b>agent_offline</b> — heartbeat missing &gt; threshold</li>
          <li><b>vuln_critical</b> — CVSS 9+ finding</li>
          <li><b>custom</b> — operator-opened</li>
        </ul>
      </>
    ),
  },
  {
    id: "incident-sla",
    term: "Incident SLA",
    oneLine: "How long the operator has to acknowledge / resolve.",
    whenSeen: "Incidents",
    category: "Threats & incidents",
    longer: (
      <>
        <p>SLA timer starts at incident open; due time depends on severity:</p>
        <ul>
          <li><b>Severe / Critical</b>: 1 hour</li>
          <li><b>High</b>: 4 hours</li>
          <li><b>Moderate</b>: 1 day</li>
          <li><b>Low</b>: 7 days</li>
        </ul>
        <p>Overdue incidents show a red badge — surface them on the SOC dashboard.</p>
      </>
    ),
  },
  {
    id: "alert-vs-threat",
    term: "Alert vs threat",
    oneLine: "Different pipelines, can both spawn incidents.",
    whenSeen: "Alerts, Threats, Incidents",
    category: "Threats & incidents",
    longer: (
      <>
        <p>
          <b>Threats</b> are Defender detections — direct from <code>Get-MpThreat</code>. They
          carry Title-case severity (Severe/High/...).
        </p>
        <p>
          <b>Alerts</b> are higher-level signals from M365 ITDR, ransomware indicators,
          watchlist matches, etc. They use lowercase severity.
        </p>
        <p>
          Critical/Severe + High from either pipeline auto-opens an incident, deduped so the
          same root event doesn't spawn two.
        </p>
      </>
    ),
  },

  // ── Policy & rules ────────────────────────────────────────────────────
  {
    id: "match-type-hash",
    term: "Match by hash",
    oneLine: "Allow this exact SHA-256.",
    whenSeen: "App Whitelist rule editor",
    category: "Policy & rules",
    longer: (
      <p>
        Strongest identity. Survives rename/move but breaks on update (a new version is a new
        hash). Mithras auto-rehashes when the same binary updates from a known publisher.
      </p>
    ),
  },
  {
    id: "match-type-publisher",
    term: "Match by publisher",
    oneLine: "Allow anything signed by this Authenticode publisher.",
    whenSeen: "App Whitelist rule editor, WDAC",
    category: "Policy & rules",
    longer: (
      <p>
        Survives updates. Inherits the publisher's full catalog — e.g. trusting "Microsoft
        Corporation" trusts almost every Windows binary. Use trusted-path instead for narrower
        scope.
      </p>
    ),
  },
  {
    id: "match-type-path",
    term: "Match by path",
    oneLine: "Allow anything in this folder glob.",
    whenSeen: "App Whitelist rule editor, WDAC",
    category: "Policy & rules",
    longer: (
      <p>
        Brittle: an attacker who can write to the folder can drop their own binary there.
        Mostly useful for OS paths like <code>C:\Windows\System32\*</code>. For application
        directories, use <b>trusted-path</b> instead so the binary must also be signed.
      </p>
    ),
  },
  {
    id: "match-type-trusted-path",
    term: "Match by trusted path (Airlock-style)",
    oneLine: "Allow only if BOTH path AND publisher match.",
    whenSeen: "App Whitelist rule editor, WDAC",
    category: "Policy & rules",
    longer: (
      <>
        <p>
          Compound rule. Example: allow <code>C:\Program Files\Adobe\*</code>{" "}
          <b>only if</b> the binary is signed by <i>"Adobe Inc."</i>. Closes the
          "drop unsigned payload into a trusted folder" bypass.
        </p>
        <p>Recommended default for application directories. Modelled on Airlock Digital's "Trusted Path" rule type.</p>
      </>
    ),
  },
  {
    id: "default-policy",
    term: "Default policy",
    oneLine: "The policy auto-assigned to new endpoints in an org.",
    whenSeen: "Policy editor, EndpointDetail badges",
    category: "Policy & rules",
    longer: (
      <p>
        Each org has at most one default Defender policy and one default firewall policy. New
        endpoints auto-inherit them on enrolment. Override per endpoint or via group membership.
      </p>
    ),
  },

  // ── Identity & auth ───────────────────────────────────────────────────
  {
    id: "tenant-org",
    term: "Tenant (organisation)",
    oneLine: "A customer the MSP manages.",
    whenSeen: "Everywhere",
    category: "Identity & auth",
    longer: (
      <p>
        Mithras is multi-tenant: Peritus (or your MSP) operates many customer organisations,
        each with its own endpoints, policies, users. Super-admins see all orgs; org members
        see only their own — Mithras refuses every cross-tenant read at the data layer, so
        a misclick or a UI bug can't expose another customer's data.
      </p>
    ),
  },
  {
    id: "impersonation",
    term: "Impersonation",
    oneLine: "Super-admin pivots into a customer org to view their data.",
    whenSeen: "Tenant switcher, Activity log",
    category: "Identity & auth",
    longer: (
      <p>
        A super-admin can act in the context of any customer org without holding membership.
        Every pivot writes a start and end entry to the activity log so customer admins can
        see exactly when and why their account was accessed.
      </p>
    ),
  },
  {
    id: "hmac-vs-bearer",
    term: "HMAC vs bearer-token agent auth",
    oneLine: "Modern (signed) vs legacy (long-lived token).",
    whenSeen: "Agent enrolment, EndpointDetail debug",
    category: "Identity & auth",
    longer: (
      <>
        <p>
          Mithras agents use one of two ways to prove they're talking to the right server:
        </p>
        <ul>
          <li><b>Modern (v0.5+)</b> — each check-in is cryptographically signed with a
            per-machine secret. If a packet is altered in transit, the server rejects it.</li>
          <li><b>Legacy (v0.4 and earlier)</b> — uses a long-lived token instead of a
            signed signature. Still safe, but harder to rotate.</li>
        </ul>
        <p>
          Older agents upgrade themselves to the modern flow on their first check-in after
          patching — no operator action needed.
        </p>
      </>
    ),
  },
];

const CATEGORIES = ["Concepts", "Modes & states", "Threats & incidents", "Policy & rules", "Identity & auth", "Telemetry"] as const;

export default function Glossary() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return ENTRIES;
    const needle = q.toLowerCase();
    return ENTRIES.filter(
      (e) =>
        e.term.toLowerCase().includes(needle) ||
        e.oneLine.toLowerCase().includes(needle) ||
        e.id.includes(needle),
    );
  }, [q]);

  const grouped = useMemo(() => {
    const out = new Map<string, GlossaryEntry[]>();
    for (const e of filtered) {
      if (!out.has(e.category)) out.set(e.category, []);
      out.get(e.category)!.push(e);
    }
    return out;
  }, [filtered]);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Glossary</h1>
          <p className="text-muted-foreground mt-1">
            Plain-English definitions for the terms you'll see across Mithras. Every <code>?</code>{" "}
            button on the platform links back here.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search terms…"
            className="pl-8"
            autoFocus
          />
        </div>

        {CATEGORIES.map((cat) => {
          const entries = grouped.get(cat);
          if (!entries || entries.length === 0) return null;
          return (
            <section key={cat} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {entries.map((e) => (
                  <Card key={e.id} id={e.id} className="scroll-mt-20">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{e.term}</CardTitle>
                        <Badge variant="outline" className="text-[10px] shrink-0">{e.category}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{e.oneLine}</p>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4">
                      {e.longer}
                      <p className="text-xs text-muted-foreground pt-2 border-t">
                        <span className="font-medium">Where you'll see it:</span> {e.whenSeen}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No glossary entries match "{q}".
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
