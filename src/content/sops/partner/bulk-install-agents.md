---
title: Bulk-install the Mithras agent across a customer fleet
audience: partner
description: Deploy the Mithras agent across a customer's Windows fleet using the customer-scoped enrolment code, with a phased rollout that validates connectivity, captures heartbeats, and confirms Defender policy uptake before completing the engagement.
order: 7
estimated_minutes: 120
updated_at: 2026-06-12
tags: deployment, rollout, onboarding, customer, agent
owner: Mithras Partner Success
classification: Operational procedure
review_cadence: Quarterly
---

## Purpose
This procedure walks a partner technician through bulk-installing the Mithras agent across an entire customer fleet. It applies to first-time customer onboarding (initial deployment of any size) and to fleet expansions where a customer adds machines after the original rollout. The procedure assumes the customer has been created and licensed under the partner's reseller scope; it does not cover customer creation or licence allocation.

## Audience and authority
The operator executing this procedure is a partner staff member signed in under a reseller organisation that has the customer in its `parent_organization_id` hierarchy. The route `/partner/customers/:id` is gated by `is_reseller_of(auth.uid(), :id)`. The operator must also hold local administrator credentials on every endpoint receiving the install — either through a domain admin account, an RMM-deployed local admin, or LAPS-issued credentials. Without local admin the install fails immediately at the service-creation step.

## Prerequisites
- The customer organisation exists under `/partner/customers`, and your reseller credit pool at `/partner/licences` holds at least one credit per planned endpoint. If the balance is short, request a top-up from your distributor before starting; an in-flight install that exhausts the pool fails on the last machine with a `no_licence` enrolment error and the agent does not register.
- The customer's primary administrator has consented in writing (email or signed scope-of-work) to the agent deployment. The agent collects endpoint telemetry continuously; consent is a contractual prerequisite documented in the Mithras MSA.
- A change window has been agreed with the customer that includes time for one reboot per endpoint. The agent install does not require a reboot itself, but Sysmon (deployed alongside the agent for process and network telemetry) needs a reboot before its driver loads and starts producing the event stream; until then the endpoint reports a `defender_only` posture and not the full posture set.
- Workstations have outbound HTTPS to `api.mithras.com.au` and `www.mithras.com.au` on TCP 443. The endpoints connect to no other Mithras host. Confirm firewall and proxy rules permit this before mass-deployment.
- Either: a domain group policy mechanism for deploying MSIs, an RMM with software-deployment capability (NinjaOne, Datto, ConnectWise, Kaseya, N-able), or PsExec / Invoke-Command access for ad-hoc deployment to standalone machines.

## Procedure

### 1. Capture the customer-scoped enrolment code

1. Sign in to the Mithras console at `https://www.mithras.com.au` under your partner account.
2. Navigate to `/partner/customers` and select the target customer.
3. On the customer detail view, locate the **Deployment** card and select **Generate enrolment code**. A code in the format `MTHX-XXXX-XXXX-XXXX` is generated and rendered. Each code is a 24-hour single-customer token that the agent installer presents to `/functions/v1/agent-enroll`; it ties the resulting endpoint to this customer's `organization_id`.
4. Copy the code into your password manager under the customer's vault entry. Do not embed the code in shared documentation, ticket bodies, or build scripts — it expires in 24 hours and is single-customer-scoped, but during that window an attacker holding the code can enrol arbitrary endpoints into the customer's fleet.
5. Capture the one-liner install command displayed beneath the code. The command is of the form `iex (irm https://api.mithras.com.au/install.ps1?code=MTHX-XXXX-XXXX-XXXX)`. This is the canonical install for first-time deployments; the bundled MSI variant for RMM is exposed via **Download installer** beneath the one-liner.

### 2. Build the deployment payload

The deployment payload differs by delivery vector. Build the payload that matches your RMM or scripting model.

**RMM software-deployment package.** Download the MSI from **Download installer** on the customer detail view. The MSI accepts the enrolment code as the `MITHRAS_CODE` MSI property. The full silent install command line is:

```cmd
msiexec /i MithrasAgent.msi MITHRAS_CODE=MTHX-XXXX-XXXX-XXXX /qn /norestart /l*v %TEMP%\mithras-install.log
```

Wrap this command in the RMM's package definition. Set the package to run as SYSTEM with elevated privileges. Most RMMs handle this correctly by default; confirm before pushing to a production fleet.

**PowerShell remoting (Invoke-Command).** Construct a deployment script that takes a list of hostnames and the enrolment code, and executes the one-liner on each:

```powershell
$code  = 'MTHX-XXXX-XXXX-XXXX'
$hosts = Get-Content C:\Deploy\fleet-batch-1.txt
$cred  = Get-Credential   # local admin or domain admin
Invoke-Command -ComputerName $hosts -Credential $cred -ScriptBlock {
    param($c)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    iex (Invoke-RestMethod "https://api.mithras.com.au/install.ps1?code=$c" -UseBasicParsing)
} -ArgumentList $code -ThrottleLimit 10
```

The `ThrottleLimit` of 10 controls the concurrency. Higher values can saturate the customer's WAN egress on small connections; lower if the customer reports degraded throughput during the deployment window.

**Active Directory Group Policy software installation.** GPO software installation does not run the installer the first time a machine boots; the install fires on the next user logon. Pair the GPO with a startup script that runs `msiexec /i \\fileserver\mithras$\MithrasAgent.msi MITHRAS_CODE=MTHX-XXXX-XXXX-XXXX /qn /norestart`. Place the MSI on a file share readable by the Domain Computers group. Do not embed the code in the MSI itself — re-issue the GPO when the code expires.

### 3. Run the pilot batch

Mass deployment starts with a small pilot to surface any per-customer obstacle (proxy, antivirus, group policy lockdowns) before it affects the whole fleet.

1. Select between three and five endpoints representative of the customer's environment — at least one server, one user workstation, and any specialist machine class (point-of-sale, kiosk, design workstation). Servers are last on most rollouts but should be in the pilot to surface server-only issues before the full server-fleet pass.
2. Deploy the agent to the pilot batch using your chosen delivery vector from step 2.
3. Within ten minutes of installation, the agent's first heartbeat populates the customer's `/customer/endpoints` view. Confirm each pilot machine appears with `last_seen_at` within the last five minutes and `agent_version` matching the current active version published in `/partner/customers → customer → Deployment → Active agent version`.
4. On at least one pilot endpoint, sign in interactively as a standard user and confirm the Mithras tray icon appears in the system tray with a green badge. The icon serves a triple purpose: it confirms the service is healthy, it provides the user with a tamper-resistant indicator that they are protected, and it is the entry point for the user-facing self-service surface.

### 4. Validate the pilot before broadening

Before deploying to the rest of the fleet, confirm that the pilot endpoints report healthy posture and have received the customer's default policy set. A misconfigured policy at this stage gets deployed to every endpoint in step 5; catching it now saves a re-rollout.

1. Navigate to `/partner/customers → customer → Health`. The customer health view reports the percentage of online endpoints, the percentage with full Defender posture, and the count of endpoints with open vulnerability findings.
2. Confirm that each pilot endpoint reports `Real-time protection: enabled`, `Behavior monitor: enabled`, `Defender signature age: ≤ 24h`, and `Network firewall: enabled`. A pilot endpoint that reports anything else indicates the customer's existing posture has a baseline issue — typically a group-policy-disabled Defender component or a third-party AV that displaced Defender. Resolve the baseline issue and reset the agent (Restart MithrasAgent service from `/partner/customers → endpoint → Restart agent` row action) before continuing.
3. Trigger a manual policy push on one pilot endpoint by visiting its `/customer/endpoints/:id` page and selecting **Re-apply policies**. The next heartbeat (within 30 seconds) reports the policy uptake. Confirm that the policy ID returned matches the customer's `default_defender_policy_id` and `default_windows_update_policy_id` displayed on the customer's policy tab.
4. If any of these checks fail, open a support ticket via `https://www.mithras.com.au/contact` referencing the customer organisation and the failing endpoint id. Do not proceed to step 5 until the pilot is fully green.

### 5. Roll out to the remainder of the fleet

1. Stage the remaining endpoints into batches of no more than 100 per hour. Mass-enrolment beyond 100/hour can saturate the customer's WAN egress with initial telemetry shipments (typically 8–12 MB per endpoint over the first thirty minutes as the agent ships its baseline inventory) and can briefly elevate the platform's per-customer write rate above the rate-limiter threshold, causing some heartbeats to back off.
2. Deploy each batch using the same delivery vector as the pilot. Wait until each batch reports a green status on `/partner/customers → customer → Health` before issuing the next batch.
3. After every batch, capture in the customer's onboarding ticket: the batch size, the timestamp range, the number that successfully enrolled, and any machines that failed to enrol with the enrolment error returned. Common enrolment errors and their causes are in the Troubleshooting section.

### 6. Final acceptance verification

1. On `/partner/customers → customer → Health`, confirm the **online endpoint count** matches the customer's published asset register, or document the exact discrepancy with the customer's IT contact (laptop in repair, machine being retired, dormant lab system).
2. Open `/partner/customers → customer → Reports` and run the **30-day baseline report**. The first run on a new customer reports the post-rollout baseline and is the reference point the monthly customer report compares against.
3. Confirm with the customer that the Mithras tray icon is visible on the standard workstation image, the standard server image, and any RDP session image they use. If the icon is missing from any image, the agent's tray-launcher is being suppressed by a group policy that hides `C:\Program Files\Mithras\MithrasTray.exe` from the user's startup. Resolve by exempting the path from the relevant policy.
4. Email the customer's primary administrator confirming the rollout is complete, attaching the baseline report PDF, and reminding them to invite their internal staff to `/customer` with `customer_admin` or `customer_member` role.
5. Close the deployment ticket. The customer now appears in the partner monthly billing rollup with a populated endpoint count and the rollout passes to ongoing monitoring.

## Verification

- The customer's `/partner/customers → customer → Health` view reports an online endpoint count equal to (or differing from by a documented amount) the customer's published asset register.
- Every endpoint reports `agent_version` matching the current active version.
- Every endpoint reports `Real-time protection: enabled` and `Behavior monitor: enabled` in `/customer/endpoints` health column.
- The customer's `default_defender_policy_id` and `default_windows_update_policy_id` are non-null and a manual re-apply on one endpoint completes successfully.
- An entry exists in `public.activity_logs` with `action_type = 'customer_baseline_report_generated'` for the customer organisation.

## Troubleshooting

- **`enrolment_code_expired` on every machine in a batch.** The code lifetime is 24 hours from generation. Regenerate the code from step 1 and re-run the batch with the new code; previously-enrolled endpoints are not affected.
- **`licence_unavailable` after partial batch success.** The customer ran out of licences mid-batch. Top up via `/partner/credits` → request from distributor, then re-run the install on the failed machines. The failed machines do not consume a licence so no clean-up is required.
- **`already_enrolled` on a re-installed machine.** A previous enrolment was not decommissioned before the new install. The agent presents the machine's stable hardware id, the server detects a prior record, and the install aborts to prevent silent split-brain. Resolve by visiting `/partner/customers → endpoint → Decommission`, which marks the prior record `is_active = false` and frees the hardware id. Re-run the install.
- **Install completes but no heartbeat within 15 minutes.** Either the endpoint cannot reach `api.mithras.com.au` (proxy / firewall blocks outbound 443), or the agent service did not start (run `Get-Service MithrasAgent` on the endpoint). Connectivity is the most common cause; confirm with `curl -sI https://api.mithras.com.au/health` from the endpoint. Service start failure is typically caused by an existing service of the same name from a prior install; uninstall the prior service via `sc.exe delete MithrasAgent` and re-run the install.
- **Tray icon does not appear.** The tray icon is launched by `MithrasTray.exe` on user logon via an HKLM `Run` key. If the icon is missing on a fresh logon, either the launcher path is being suppressed by group policy (resolve by exempting `C:\Program Files\Mithras\`), or the customer has a restricted-desktop policy that hides all third-party tray icons (resolve by reducing the policy or adding Mithras to its allow list). The agent service continues to run and protect regardless of tray-icon visibility.

## Audit and compliance

- Every successful enrolment writes `endpoint_enrolled` to `public.activity_logs` with the partner's `user_id`, the customer's `organization_id`, and the new endpoint's `endpoint_id`.
- The enrolment code itself is single-customer-scoped and short-lived; codes are recorded under `public.enrollment_tokens` with `created_by`, `customer_organization_id`, and `expires_at`. Codes do not appear in plaintext after first display; subsequent access shows the hashed prefix only.
- The baseline report (step 6) writes a row to `public.customer_reports` with `report_type = 'baseline'`. This is the reference point against which monthly customer reports compute trend lines.
- Partner billing for the customer commences on the day the first endpoint successfully heartbeats, prorated against the next monthly invoice cycle.

## Related procedures

- [Add a customer](/help/sops/partner/add-customer)
- [Push an agent update across a customer fleet](/help/sops/partner/push-agent-update)
- [Decommission an endpoint](/help/sops/partner/decommission-endpoint)
- [Review the monthly customer report](/help/sops/partner/review-monthly-customer-report)
