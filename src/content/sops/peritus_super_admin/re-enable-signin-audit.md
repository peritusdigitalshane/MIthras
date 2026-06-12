---
title: Re-enable signin / audit M365 polling after a Premium upgrade
audience: peritus_super_admin
description: When a customer upgrades to Entra ID Premium and gains access to signin and audit logs, flip the supported flags so the ITDR poller picks them up.
order: 5
estimated_minutes: 10
updated_at: 2026-06-12
tags: m365, itdr, entra
---

## When to use this
A customer just upgraded their Microsoft 365 tenant from Business Basic / Standard to a SKU that includes **Entra ID Premium P1** or **P2** (typically Business Premium, Enterprise Mobility + Security, or M365 E3/E5). Premium unlocks two Graph endpoints we previously couldn't read:

- `auditLogs/signIns` — sign-in events with geo, risk, and conditional-access context.
- `auditLogs/directoryAudits` — directory change events.

Without Premium, the M365 ITDR poller logs these as `no_premium` and skips them. After upgrade, we need to flip the flags so the poller starts ingesting.

## Prerequisites
- The customer has confirmed (in writing) the SKU upgrade is complete.
- You have super-admin scope and access to `/m365`.

## Steps

1. Open **`/m365`** and find the customer's tenant row.
2. Click the tenant. You'll see the **Capability flags** card with the current state of:
   - `signin_audit_supported` (typically `false`)
   - `directory_audit_supported` (typically `false`)
3. Click **Probe capabilities**. The platform makes a test call against each endpoint with the tenant's stored OAuth token. Possible outcomes:
   - **200 OK** → endpoint is accessible; flag will be flipped to `true` and persisted.
   - **403** → the tenant does NOT have Premium yet (or the app doesn't have the right Graph permission scopes). Don't flip the flag manually.
   - **401** → OAuth token is expired or the app registration is missing. Re-run the customer's OAuth flow first.
4. After a successful probe, the row shows ✅ for the relevant flag.
5. Wait for the next ITDR poll cycle (every 5 min). Verify in `/m365` that `signins_polled` is no longer `no_premium` — it should now show the actual count of sign-ins ingested.

## Manual flag flip (rare)

If the probe consistently fails with a transient error but you have confirmation Premium is active, you can manually flip the flag:

1. From the same tenant detail, click **Edit capability flags**.
2. Tick `signin_audit_supported` and/or `directory_audit_supported`.
3. Add a reason note. This lands in `activity_logs` with your user id.
4. Click **Save**.

The next poll will attempt to fetch. If it 403s, the flag auto-flips back to `false` and you'll see an entry in `platform_health_findings` as an open finding.

## Verify
- Tenant detail shows both flags green.
- `/m365` shows `signins_polled > 0` within 5 min.
- The customer's `/m365/posture` page now shows the "Recent sign-ins" card with data.
- The audit-log entry for the flag flip is in `activity_logs`.

## Troubleshooting
- **Probe returned 200 but next poll still says `no_premium`.** Stale cache. Restart the `peritus-edge-functions` container — it caches tenant config for 5 min.
- **Flag flipped to `true` automatically but signins still empty.** Premium is on but the app registration is missing `AuditLog.Read.All` permission. Go to the customer's Azure portal → app registration → add the permission → admin consent.
- **Flag keeps flipping back to `false`.** Auto-rollback is firing because polls are 403ing. Either Premium isn't actually active or the app permission is missing.

## Related
- [Onboard distributor](/help/sops/peritus_super_admin/onboard-distributor)
- [Customer admin: review threats](/help/sops/customer_admin/review-threats)
