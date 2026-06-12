---
title: Push an agent update to all out-of-date endpoints
audience: partner
description: Use the bulk-upgrade button on /endpoints to roll the latest stable agent to every PowerShell endpoint that's behind.
order: 2
estimated_minutes: 5
updated_at: 2026-06-12
tags: agent, upgrade, maintenance
---

## When to use this
The blog or change-notes mention a new stable agent version with a fix or capability you want on every endpoint. The button shows the count of endpoints that are behind — when that count is more than 1–2, bulk-pushing beats clicking through each one.

## Prerequisites
- You're signed in as super-admin or org admin (members will not see the bulk button).
- You're scoped to the org you want to upgrade (use the org switcher in the header). Super-admins with no org scoped will upgrade **across every org** — be sure that's what you intend.

## Steps

1. Go to **`/endpoints`**.
2. Look at the row above the table — you'll see one of three things:
   - **"All up to date (v0.7.17)"** chip — nothing to do.
   - **"Upgrade N to v0.7.17"** button — N endpoints are behind.
   - **"Checking versions…"** — wait a second.
3. Click **Upgrade N to v0.7.17**.
4. The confirmation dialog shows:
   - The exact count
   - The first 10 hostnames + their current → target version
   - A warning that a few endpoints will briefly go offline mid-upgrade
5. Review the list. If anything looks wrong (wrong customer scope, an endpoint you don't want touched), **Cancel**.
6. Click **Push to N**. A toast confirms how many upgrades were queued + how many were already in flight (skipped).
7. Agents pick up the command on their next heartbeat — typically under 60 seconds — and self-update. Most go offline for 30–60 seconds during the swap.

## Verify
- The button re-evaluates after 30 seconds and shows the new lower count (or "All up to date" if everyone finished).
- Individual endpoint detail pages show the **Upgrade queued** chip while in flight, then return to the green **Up to date** badge.
- The agent activity log on each endpoint shows `agent_self_update -> v0.7.17 ok`.

## Troubleshooting
- **A few endpoints stay behind for an hour+.** They're probably offline. The command will fire whenever they come back. Check `/endpoints` filtered by `status=offline`.
- **An endpoint logs `upgrade_failed`.** Open its detail page, check the agent update history tab. The most common cause is the agent being unable to reach `agent-bundles` storage — verify no proxy is intercepting `*.mithras.com.au`.
- **You queued the wrong scope.** Already-fired upgrades can't be cancelled cleanly. They'll fail-forward to the new version which is generally safe (we don't ship breaking changes in patches). Wait it out.

## Related
- [Decommission a retired endpoint](/help/sops/partner/decommission-endpoint)
- [Customer admin: install the agent](/help/sops/customer_admin/install-agent-on-endpoint)
