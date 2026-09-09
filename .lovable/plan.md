
# Plan: Fix All 17 Audit Findings

Items 1, 2, 7 are already fixed. Remaining: 3-6, 8-17.

## Phase 1: Agent API Fixes (Edge Functions)

### Issue 3+4: GPO policy conflict resolution
- Update `/gpo-policy` in `agent-api` to fetch ALL group memberships, pick the one with the highest-priority group (lowest `id` or explicit priority field), return that GPO policy
- If multiple groups have GPO policies, use deterministic ordering (earliest created group wins)

### Issue 5: Firewall source group IP resolution
- Complete the stub in `agent-api` — resolve endpoint IPs from group memberships and return them as `allowed_source_ips`

### Issue 16: Heartbeat interval
- Change agent heartbeat from 30s to 60s in `agent-script`

## Phase 2: Agent Improvements (PowerShell in agent-script)

### Issue 13: Rollback mechanism
- Before applying GPO/WDAC policies, export current settings to a backup file
- On failure, restore from backup and log the error

### Issue 14: Agent health reporting
- Add error collection during enforcement
- Send health/error data back to the API on each heartbeat via a new `/health` endpoint in agent-api
- Store in `endpoint_logs` table

### Issue 15: TLS certificate pinning
- Add `-CertificateThumbprint` or custom certificate validation callback to `Invoke-RestMethod` calls (note: basic HTTPS validation is already in place, this adds pinning)

### Issue 17: Domain GPO detection
- Before applying GPO, check `(Get-WmiObject Win32_ComputerSystem).PartOfDomain`
- If domain-joined, skip local GPO enforcement and log a warning

## Phase 3: Database & Backend

### Issue 6: Event log retention cron
- Create a migration to set up `pg_cron` to call the `cleanup-old-data` edge function daily
- OR: Add a `pg_cron` job that directly deletes old event logs based on `event_log_retention_days`

### Issue 8: Alert/notification system
- Create `alerts` table (type, severity, endpoint_id, organization_id, message, acknowledged, created_at)
- Create DB trigger that auto-creates alerts when: new threat inserted, endpoint goes offline (via function)
- Add Alerts page in UI with badge count in sidebar

### Issue 9: Audit trail for policy changes
- Already have `activity_logs` table and `logActivity` calls in hooks
- Verify all policy CRUD hooks (Defender, GPO, WDAC, UAC, WU) call `logActivity`
- Add missing ones

### Issue 11: RBAC improvements
- Add `viewer` role to `org_role` enum
- Update RLS policies to differentiate viewer (read-only) from member
- Update UI to hide edit controls for viewers

## Phase 4: UI Improvements

### Issue 10: Bulk endpoint actions
- Add checkbox selection to endpoints table
- Add bulk action toolbar (assign policy, move to group, force scan)

### Issue 12: Dashboard data verification
- Audit `useDashboardData` hook to confirm it queries real aggregates, not mock data
- Fix any remaining hardcoded values

## Phase 5: Test Cases
- Edge function tests for agent-api (GPO resolution, health endpoint, firewall IP resolution)
- Frontend component tests for alerts page, bulk actions, endpoint detail
- Unit tests for dashboard data hooks

## Files to modify
| File | Changes |
|------|---------|
| `supabase/functions/agent-api/index.ts` | GPO conflict resolution, health endpoint, firewall IP fix |
| `supabase/functions/agent-script/index.ts` | Rollback, health reporting, TLS pinning, domain detection, 60s heartbeat |
| `src/pages/Dashboard.tsx` | Verify real data |
| `src/components/dashboard/EndpointsTable.tsx` | Bulk actions |
| `src/components/layout/Sidebar.tsx` | Alert badge |
| New: `src/pages/Alerts.tsx` | Alert management page |
| New: `src/hooks/useAlerts.ts` | Alert data hooks |
| Migration | alerts table, viewer role, pg_cron cleanup |
| Tests | Edge function + frontend tests |
