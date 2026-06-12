---
title: Request an emergency unlock for an endpoint
audience: customer_admin
description: Queue a time-bounded Defender unlock for a single endpoint to clear a legitimate blocker without disabling protection across the fleet.
order: 6
estimated_minutes: 5
updated_at: 2026-06-12
tags: defender, emergency, response
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure queues an `emergency_unlock` command to a single endpoint. The command instructs the agent to disable tamper protection for a specified window so that a documented, legitimate action can complete. Outside that window, posture is unchanged. The procedure is the controlled alternative to disabling Defender locally; local disablement removes tamper protection without a time bound, fails the posture chip, and surfaces in the monthly customer report as an exception.

## Audience and authority
Customer administrators whose `organization_memberships.role` is `admin` or `owner`. The unlock is dispatched through the agent's `DefenderStateCollector` module and is logged to `public.activity_logs` with the actor identifier and the documented reason.

## Prerequisites
- A user in your organisation is blocked from a legitimate action by a Defender control: a quarantined installer, a controlled-folder-access write block, or an Attack Surface Reduction rule.
- You have identified the affected endpoint by hostname.
- You can describe the blocked action in one sentence of at least twenty characters.
- The endpoint has reported a heartbeat within the last 24 hours.
- The agent on the endpoint is at version 0.7.5 or later. Earlier agents do not implement the `emergency_unlock` command.
- You are signed in to the Mithras console at `https://www.mithras.com.au/login`.

## Procedure

1. Open `/endpoints`. Locate the affected endpoint by hostname and open its detail page at `/endpoints/:id`.
2. Locate the **Response actions** card.
3. Select **Emergency unlock**.
4. Complete the dialog:
   - **Reason** — minimum twenty characters. State precisely what is blocked and the business justification. For example: `User cannot install QuickBooks 2024 update; Defender quarantined qbinstall.exe at C:\Temp\install`. This text is written to the audit log and reproduced in your monthly customer report.
   - **Duration** — one of `15min`, `30min`, `60min`, `4h`. Select the shortest duration that resolves the blocker.
   - **Acknowledgement** — tick the acknowledgement box confirming that tamper protection will be disabled for the selected window.
5. Select **Unlock**. The platform queues an `emergency_unlock` command. The agent collects the command at its next heartbeat and disables tamper protection for the requested duration. The agent re-enables tamper protection automatically when the timer expires.

## Verification
- The endpoint at `/endpoints/:id` displays the **Emergency unlock active** banner with the expiry timestamp on the **Defender posture** card.
- The **Command history** on the same page lists the `emergency_unlock` command with status `confirmed`.
- The audit log at `/activity` contains a row with `action_type = 'emergency_unlock'`, your user identifier, the duration, and the reason text.
- The end-user observes a tray notification on the endpoint stating that an emergency unlock is active and the remaining time.
- After the timer expires, the **Emergency unlock active** banner is removed and the Defender posture chip returns to its prior state.

## Troubleshooting
- **The unlock command remains in `queued` status for more than ten minutes.** Confirm the endpoint is online by checking **Last seen** on `/endpoints/:id`. If the endpoint is offline, the command is delivered on the next heartbeat. If the endpoint is online and the command does not advance, the agent version is below 0.7.5; arrange an agent upgrade before retrying.
- **The user reports the action is still blocked.** The `emergency_unlock` command relaxes Defender runtime controls only. Application whitelisting, ASR rules in `block` mode for non-Defender controls, and conditional access policies are unaffected. Inspect the endpoint at `/endpoints/:id` to identify the blocking control and act on that control directly through `/policies` or your reseller.
- **The `4h` option is unavailable.** Your reseller has capped the maximum unlock duration for your tier. Request a tier change or a per-incident exemption from your reseller.
- **The endpoint does not return to a green posture after the timer expires.** Trigger a manual posture refresh from the endpoint detail page. If the chip remains amber for more than one collection cycle, raise the case with your reseller; the agent log at `C:\ProgramData\Mithras\logs\agent.log` contains the relevant `DefenderStateCollector` entries.

## Audit and compliance
- The command is recorded in `public.activity_logs` with `action_type = 'emergency_unlock'`, the duration, the reason, the targeted endpoint, and `actor_id = auth.uid()`.
- The agent's tamper-protection state changes are recorded in `public.endpoint_status` on each collection cycle for the lifetime of the unlock window.
- The unlock event is summarised in the monthly customer report distributed via `public.customer_reports`. The reason text you provided is reproduced verbatim.
- Records are retained for 24 months in accordance with the customer's data retention configuration.

## Related procedures
- [Manage the Microsoft Defender policy applied to your endpoints](/help/sops/customer_admin/manage-defender-policy)
- [Review threats detected on your endpoints](/help/sops/customer_admin/review-threats)
- [Read and act on an incident detail page](/help/sops/customer_admin/understand-incident-detail)
