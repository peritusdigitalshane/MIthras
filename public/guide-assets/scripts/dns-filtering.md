# DNS — Block malicious DNS without breaking the customer's internal network

**Target length:** 84 seconds
**Slug:** `dns-filtering`

## Setup

1. A customer with `dns_module_enabled = true` and a default DNS policy
2. Have the agent installed on at least one endpoint and the NRPT rules
   already pushed
3. Be ready to query a known-bad domain to demonstrate the block. The
   Cloudflare for Families test domain `phishing.testcategory.com` works
   if Cloudflare Family is the upstream.

## Shot list & voiceover

### [00:00 – 00:10]
**SHOW:** `/dns-filtering` page, default policy selected, "Filtering" tab
showing category toggles and the custom allow/deny lists.

**SAY:** "DNS filtering in Mithras works like Cisco Umbrella for DNS-layer
security — but multi-tenant by design and tied directly into your existing
policy console."

### [00:10 – 00:22]
**SHOW:** Quick architecture diagram (slide or animated cut): endpoint →
DoH → Mithras resolver → upstream. Highlight the URL pattern with the
org UUID in the path.

**SAY:** "Endpoints route DNS to a Mithras-hosted DoH resolver. Each query
carries the customer's unique ID in the URL path, so the resolver applies
the right policy."

### [00:22 – 00:36]
**SHOW:** Open PowerShell on the endpoint. Run `nslookup
phishing.testcategory.com`. The response is NXDOMAIN. Cut to the Insights
tab in the SOC — the new block log entry appears at the top.

**SAY:** "Malicious domains return NXDOMAIN — blocked before the endpoint
ever connects. The decision is logged with timestamp, endpoint, and reason."

### [00:36 – 00:50]
**SHOW:** Switch to the "Internal scopes" tab. Click "Add scope". Type
`corp.local` as the suffix, paste two AD DNS IPs. Save. The new scope
appears in the list.

**SAY:** "Internal suffixes are the tricky part most cloud DNS products
handle badly. In Mithras, you add each internal scope — corp dot local,
an AD reverse-DNS zone, whatever you need."

### [00:50 – 01:04]
**SHOW:** Back on the endpoint, PowerShell. Run
`Get-DnsClientNrptRule | Where Comment -match 'Mithras'`. Both rules
appear — the internal-scope rule and the default DoH rule.

**SAY:** "The agent pushes those as Windows NRPT rules. Internal queries
resolve directly via the customer's own DNS forwarders. External queries
route through us."

### [01:04 – 01:16]
**SHOW:** Back to the SOC, Insights tab. Top Blocked and Top Queried lists,
the summary cards with totals.

**SAY:** "Insights show you what's actually being blocked, which endpoints
are talking to what, and where the noisy domains are."

### [01:16 – 01:24]
**SHOW:** Slow zoom on the page title and the locked-down rule. End on
the Mithras logo.

**SAY:** "DNS-layer protection plus split DNS. The endpoint never knows
it's being filtered. The customer's AD never breaks."

### END
