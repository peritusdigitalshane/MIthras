# Reseller First-Week Playbook

For a brand-new reseller a distributor just signed up via the Mithras portal.
This is what their first week should look like to close their first deal by Friday.

---

## Day 1 — Sign in + tour (45 min)

1. Click the **enrolment URL** the distributor emailed (`/signup?code=XXXXXXXX`).
2. Create your account — the first person to claim the URL becomes admin of your reseller org.
3. Open `/partner` — that's your dashboard. Bookmark it.
4. Walk through the Sidebar:
   - **My customers** — where you'll add each end customer
   - **Billing** — what you owe the distributor at end of month
   - **Invoices** — invoices issued to you for past cycles
   - **Sales kit** (under `/distributor/resources` if distributor has shared) — pitch deck, one-pager, demo script, battle cards
5. Read the one-pager. It's how you'll explain Mithras to your first prospect.

## Day 2 — Add your first customer (20 min)

1. Click **My customers → Add customer**.
2. Pick a customer you already serve and trust to try a pilot.
3. Pricing: leave blank to inherit your default rate, OR set a special pilot rate.
4. Go to **Deploy agent** → generate the one-line PowerShell command for that customer.
5. Save it somewhere safe — that's the agent enrolment token.

## Day 3 — Run the demo (30 min internally + 30 min with customer)

1. Read `demo-script.md` once through. Don't skim.
2. Practice the 15-minute flow against the demo tenant before doing it live. The demo IS the deal.
3. Book a 30-minute Zoom/Teams with your prospect. Subject line: "Mithras demo Thursday?"
4. Run the demo. Stick to the script. Close on a pilot tenant for one of their customers.

## Day 4 — First install (45 min hands-on)

1. SSH/RDP to one of the customer's Windows endpoints (preferably one you can rollback).
2. Run the one-liner from Day 2 as Administrator.
3. Within 60s, the endpoint appears in `/endpoints` with green status.
4. Wait 5 minutes. Threats, posture, software inventory all populate.
5. Walk the customer through the dashboard. Their face when they see their own posture in real time — that's the close.

## Day 5 — Roll out the rest + invoice setup

1. Roll the agent to the rest of the customer's endpoints. The same one-line install works on any Win10/Win11 machine in their org.
2. Confirm all endpoints are reporting in `/endpoints`.
3. In `/partner/billing`, you should now see this customer with their endpoint count and your wholesale subtotal.
4. Set up your invoicing rhythm — monthly, in arrears, due net 14 to mirror your distributor's terms.

## End of week 1 — debrief

- Did the install go smoothly? If not, log it in the bug channel.
- Was the demo script convincing? Tell the distributor what landed and what didn't.
- Got a 2nd prospect lined up for week 2? You should.

---

## Common stumbles

- **"The Defender ZIP downloaded but install-agent.ps1 errored."** Make sure PowerShell is running as Administrator AND the customer's execution policy allows it (`Set-ExecutionPolicy -Scope Process Bypass`).
- **"Endpoint not showing up after install."** Check the agent service is running: `Get-Service MithrasAgent`. If yes, check the customer's firewall is letting outbound 443 through to `*.mithras.com.au`.
- **"Demo tenant is empty."** Get the distributor to share the populated demo tenant credentials. Yours has no data yet.
- **"Customer wants a discount."** You set the retail. Distributor sets your wholesale. Anything inside that margin is your call.

---

## Support escalation

| Issue | First | If unresolved |
|---|---|---|
| Sales/positioning | Your distributor | channel@mithras.com.au |
| Technical (agent, install, console) | docs.mithras.com.au | support@mithras.com.au |
| Billing / invoice dispute | Your distributor | billing@mithras.com.au |
| Security incident in a customer | Your own SOC if you have one | soc@mithras.com.au |

Response targets: technical within 4 hours AU business hours, security incident within 1 hour 24/7.
