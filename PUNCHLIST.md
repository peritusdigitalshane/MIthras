# Mithras — what's open

Snapshot as of 2026-06-17. Items grouped by where they live in your head. Update as you go.

## 🚦 Pre-launch blockers (your action, not mine)

- [x] **Apex TLS cert** — verified 2026-06-29: the live Let's Encrypt cert already covers both `mithras.com.au` and `www.mithras.com.au` (SAN: `DNS:mithras.com.au, DNS:www.mithras.com.au`, valid through 2026-09-14). Item was stale.
- [ ] **Register the Mithras Azure AD multi-tenant app** for M365 ITDR. The code is shipped but customers can't connect their tenant for sign-in audit / risky-sign-in / mailbox-rule monitoring until the app is registered and admin-consented.
- [ ] **Stripe setup** — task #244. Webhooks live but the setup runbook + production keys check still needs documenting. SOP exists at `/help/sops/platform_super_admin/configure-stripe-billing`.

## 🛟 Production-readiness debt (we now disclose honestly; still real)

- [ ] **Automated database backups** — nothing automated runs today. Manual Proxmox snapshots only. Top of the production-readiness list. `restore-from-backup.md` SOP now reflects this.
- [ ] **Status page automation** — `/status` is hand-edited; no uptime probes feed it.
- [x] **Activity-log retention policy** — 12-month rolling window, nightly pg_cron purge at 03:30 UTC. Migration `20260629110000_activity_log_retention.sql`. `/admin/audit-logs` copy updated.
- [ ] **SLA decision** — either hire 1-2 humans and offer a real SLA, or commit fully to AI-only positioning in customer comms. Currently we say "AI Commander response targets" which is honest but undifferentiated.
- [x] **Distributor invoicing UI** — `/distributor/invoices` now has a "Received from Mithras" + "Issued to resellers" tab split, with KPI strips and counterparty columns for each direction. Implemented 2026-06-29 in `PortalInvoices.tsx`.

## 🧪 Audit surfaces I haven't checked yet for false claims

(Same kind of pass that turned up 44 fixes across marketing + in-product. These haven't been audited yet.)

- [ ] **Transactional emails** — `send-home-user-welcome`, `send-signin-link`, deal-expiry, invoice, monthly customer report, threat detection notifications. Highest-leverage next pass.
- [ ] **Agent installer copy** — `install-agent.ps1`, MithrasTray tooltips, post-install messages
- [ ] **Customer API Swagger docs**
- [ ] **`/help`, `/glossary`, `/guides`** pages — heavy with feature claims I haven't checked

## ✅ Open task IDs in the tracker

- **#131** — Brand agent .exe with Mithras logo (C# launcher)
- **#244** — Deploy + verify, document Stripe setup steps
- **#316** — Deploy + test full uninstall flow on a real endpoint

## 🎯 Strategic gaps (BACKLOG — biggest competitive moves)

Ordered by impact-to-effort ratio in my view, not yours.

- [ ] **macOS agent** — biggest single competitive gap. Huntress has it; we're Windows + Linux only (and Linux is heartbeat-only).
- [ ] **M365 Conditional Access** management — read-only view of policies + AI gap analysis + deep links to fix. Sits naturally alongside ITDR.
- [ ] **Account-takeover detection** — anomalous M365 sign-in + new mail-rule / forwarding-rule in same session
- [ ] **Supplier-impersonation graph** — learn who emails whom; flag lookalike domains
- [ ] **EPSS scores on top-CVEs tile** — "predicted exploit probability in next 30 days"
- [ ] **Behavioural detection engine** beyond Defender's
- [ ] **Ransomware rollback** — VSS-based file recovery
- [ ] **Linux agent v0.2** — close the parity gap (active response, persistence collection, policy enforcement)
- [ ] **SOC 2 Type II / ISO 27001 attestation** — required for any AU-government-adjacent customer

## 📝 Audit waves complete this session

For reference — what was already cleaned up.

- **Marketing audit** — 20 false claims fixed across landing pages, /pricing, /channel-program, /security, /terms, /privacy, /status, public sales-files
- **In-product audit** — 24 false claims fixed across customer + partner + distributor + admin portals + SOPs
- **Brand cleanup** — Peritus references removed from every customer-visible surface
- **Security review** — 3 vulnerabilities found + fixed (cross-tenant email sweep, fabricated CVE mitigation via stolen agent secret, useOpenIncidentsFeed defence-in-depth)

## ⏱ Cadences as of this snapshot

So next audit-wave or feature doesn't reintroduce stale numbers.

- Agent heartbeat: 30s
- Email sweep: 2 min
- M365 ITDR poller: 5 min (unused — Azure AD app not registered)
- Platform health scan: 15 min
- Threat-intel feed refresh: hourly at :17
- AI weekly digest: daily at 02:23 UTC
- AI cost monitor: hourly
- CVE auto-scan: nightly per org
- Customer report drain: daily
