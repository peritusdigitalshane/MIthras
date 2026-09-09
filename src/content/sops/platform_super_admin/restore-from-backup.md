---
title: Restore Mithras from a Postgres backup
audience: platform_super_admin
description: Reference procedure for restoring the Mithras Supabase database. Automated backups are not yet configured — interim recovery uses manual Proxmox snapshots only.
order: 7
estimated_minutes: 60
updated_at: 2026-06-17
tags: backup, restore, postgres, disaster-recovery, runbook
owner: Mithras Customer Operations
classification: Incident-response procedure
review_cadence: Quarterly
---

> **STATUS: INTERIM PROCEDURE.** Automated nightly backups, offsite replication, and the encrypted `pg_dump` pipeline described in earlier drafts of this SOP have not yet been deployed. They remain the top item on the production-readiness backlog. The procedure below describes what is currently in place — manual Proxmox host snapshots — and the target state we are building towards. Do **not** rely on a daily artefact existing on disk at recovery time.

## Purpose
This procedure is the recovery runbook for the Mithras production database. It applies in two scenarios: (a) recovery from data corruption or accidental destructive change, and (b) full-host disaster recovery when the production VM is unrecoverable.

## Audience and authority
The operator executing this procedure is a Mithras platform operator whose `user_id` is present in `public.super_admins` and who holds the root SSH key for the production host `149.28.186.142`. The procedure manipulates the Postgres data directory and the Supabase container stack — it must not be delegated.

## What recovery options exist today

1. **Proxmox host snapshot.** The host runs on Proxmox and a snapshot of the VM disk is taken manually before each significant migration deploy. If the host is intact and the corruption is recent, rolling back to the most recent pre-deploy snapshot is the fastest path. Recovery point depends on when the last snapshot was taken — there is no guarantee of a fresh snapshot at any given moment.
2. **In-place Postgres data directory recovery.** If the corruption is scoped to a single table or row, `pg_dump`-from-running-DB and selective re-import is faster than a host rollback. This presumes the DB is still running and reachable.
3. **Re-bootstrap from migrations + manual data export.** Migrations under `supabase/migrations/` are checked into the repository. A fresh DB can be re-created from migrations; tenant data is gone in this scenario.

## Interim procedure — recover from a Proxmox snapshot

1. Open the Proxmox web UI for the host running the production VM. Authenticate as the holder of the Proxmox root credentials (Passbolt → `Infrastructure → Proxmox production`).
2. Stop the production VM cleanly: `Datacenter → <node> → <VM>: Shutdown`. Wait for the VM status to show stopped.
3. Open the snapshot panel for the VM and confirm the timestamp of the snapshot you intend to roll back to. Verify with the operator who took it that no live customer traffic has been served since the snapshot was taken; rolling back loses every change after the snapshot timestamp.
4. Roll back to the snapshot.
5. Start the VM. Wait for SSH access to recover.
6. SSH to the host and confirm the Supabase stack came up cleanly: `docker compose -f docker-compose.yml -f docker-compose.override.yml ps`. Every service should be `Up`.
7. Run the post-recovery health checks below.

## Post-recovery health checks

- Open `https://www.mithras.com.au` and confirm the landing page renders.
- Open `https://api.mithras.com.au/rest/v1/` and confirm a 200 response from PostgREST.
- Sign in to the SOC console as a super-admin and open `/admin/health` — every active finding should be one of the known ones, not a connection error.
- Confirm at least one connected endpoint has heartbeated within the last 60 seconds (`/endpoints` page, sort by last seen).
- Confirm the email sweep is running (`/email-security` page → "Last sweep" should be within 2 minutes).

## Target state (not yet operational)

The production-readiness backlog item for backups is to deploy:

- Nightly `pg_dump` to `/var/backups/mithras/daily/postgres-YYYYMMDD-HHMMSS.sql.gz`, encrypted with a key escrowed in Passbolt.
- Offsite copy via `mithras-backup-offsite.sh` to an S3-compatible store, retained 30 days.
- Quarterly restore drills against a scratch VM.

Until that work lands, document any manual snapshot taken before a deploy in `#deploys` so operators can locate it during a recovery.

## Related procedures
- [Re-enable Microsoft 365 sign-in and directory audit polling](/help/sops/platform_super_admin/re-enable-signin-audit)
- [Respond to an AI cost-budget alert](/help/sops/platform_super_admin/respond-to-ai-budget-alert)
- [Configure Stripe billing](/help/sops/platform_super_admin/configure-stripe-billing)
