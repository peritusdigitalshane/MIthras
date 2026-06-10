---
title: "Why MSPs are leaving generic RMMs for purpose-built endpoint security"
description: "Connectwise, N-able, Datto — the generic RMM does a lot of things adequately. For SMB endpoint security specifically, MSPs are increasingly running a purpose-built tool alongside. Here's why."
publishedAt: "2026-04-22"
updatedAt: "2026-05-29"
author: "Shane Stephens"
category: "MSP Strategy"
---

Walk into any Australian MSP's tooling room and you'll find the same stack: a generic RMM (Connectwise, N-able, Datto, Atera, NinjaOne — pick one) doing patching, asset inventory, remote access, and scripting; a PSA for ticketing and billing; a backup product; an EDR if the customer can afford it; and a tangle of point tools for everything else.

For the last decade that stack has been the right answer because no one has built a serious, MSP-specific endpoint security platform that doesn't cost CrowdStrike money. That's changing. We're seeing a clear pattern: MSPs aren't ripping out their RMM — that's where the patching and remote access live — but they are pulling out the endpoint-security workload and putting it on a purpose-built tool.

Here's why.

## The generic RMM problem

Generic RMMs are general-purpose remote-management platforms. They're great at "run this script on every endpoint" and "schedule this patch deployment." They were never built for the specific question an MSP gets asked every month: _how secure is each of my customer's fleets, in evidence I can hand them?_

What that means in practice:

**Defender management is bolted on.** Most RMMs ship a Defender component, but it's usually a thin wrapper over the same PowerShell anyone can write. Want to enforce attack surface reduction rules across 40 customers? You're maintaining 40 scripts, and there's no console that shows you which endpoints are compliant.

**Microsegmentation isn't there.** None of the major RMMs ship a microsegmentation module. They might have a firewall-rules-deployment feature, but they don't observe traffic, propose a ruleset, and surface drift. Microsegmentation is the single highest-impact ransomware control after backups, and the RMMs don't do it.

**Threat hunting is non-existent.** The RMM stores patching state and inventory; it doesn't store the data you'd want to query during an incident (process trees, network connections, signed binaries, persistence registry keys, scheduled tasks). When a customer asks "did this malware run anywhere?", you're SSHing into each endpoint individually.

**Reporting is generic.** Monthly customer-facing reports come out of the RMM, but they say "patching is 96% compliant" — not "this customer's endpoints would have been protected from the three highest-impact CVEs disclosed this month, here's why."

**Multi-tenancy is awkward.** Most RMMs have multi-tenant capabilities now, but they were retrofitted. Switching between customers, scoping queries, billing per-endpoint correctly — these things work but they're not first-class.

This isn't a hit piece on RMMs. They're great at what they were built for. The point is that endpoint security stopped fitting into "what they were built for" about three years ago, and the gap is now wide enough to be a profit centre for someone who fills it.

## What MSPs are picking up instead

Two categories of tool are showing up in MSP stacks alongside (not replacing) the RMM.

**Full EDRs.** CrowdStrike, SentinelOne, Huntress, ThreatLocker, Sophos Intercept X. These are excellent, technically deep, and expensive — typically AU $8-25 per endpoint per month after discounts, with significant minimums. They make sense for enterprise customers; the unit economics for a 12-endpoint SMB don't usually work.

**Defender-centric management platforms.** This is the newer category — tools that manage the Defender that's already on the box rather than running a parallel AV engine. They're cheaper because they're not licensing their own engine, and they're SMB-appropriate because they target the customers who can't or won't pay for E5.

We're squarely in the second category. Mithras manages Defender, adds microsegmentation at the Windows Firewall layer, adds DNS filtering, and ships a multi-tenant console that's built for MSP workflows from day one.

## The economics

Here's the napkin maths an MSP is running.

A 40-customer book, average 30 endpoints per customer = 1,200 endpoints.

| Cost line | Generic RMM only | RMM + Mithras MSP |
|---|---|---|
| RMM | $9,600/yr ($8/ep/yr typical SMB) | $9,600/yr |
| EDR (CrowdStrike Falcon Go) | $129,600/yr if you cover everyone | nil |
| Mithras MSP | nil | $43,200/yr (1,200 × $3/mo × 12) |
| **Total endpoint security spend** | **$139,200/yr** | **$52,800/yr** |

The difference is roughly AU $86,000/yr that the MSP either passes through to the customer as savings or keeps as margin. For an MSP doing AU $2-5M revenue, that's a meaningful change in security gross margin.

The trade is real: you don't get full per-process telemetry centralised in a SOC-grade product. For SMB customers, the question is whether that gap matters more than the cost. For most SMBs the answer is no — they need _basic competent_ endpoint security, not enterprise-grade hunting. Layered with microsegmentation and DNS filtering, Defender does basic-competent very well.

## What the conversion looks like

We're seeing MSPs move in three phases.

**Phase 1 — Add to your stack for one customer.** Pick a customer who's been asking for "more security but not at CrowdStrike prices." Deploy alongside the RMM. Sell it as an enhancement, not a replacement.

**Phase 2 — Make it the standard for new customers.** Default Mithras (or your chosen alternative) into the proposal for every new SMB. Position it as "managed Defender + microsegmentation" so customers understand what they're getting.

**Phase 3 — Migrate existing customers at renewal.** As each customer's existing security contract comes up for renewal, migrate to the new stack. Don't force migrations mid-contract; the operational cost isn't worth it.

The trap to avoid: trying to use the new tool for everything. Mithras isn't a replacement for the RMM's patching workflows, its remote-access tooling, or its scripting engine. Keep using the RMM for those. Use the security platform for security. The reason this works is that the tools are designed for different jobs.

## When the generic RMM is still the right answer

To be fair: if your customer base is 90% non-Windows, or if you're an internal IT team rather than an MSP and you only have one tenant to manage, the calculus changes. The generic RMM with its built-in Defender module is enough when you've only got one organisation to worry about and a small fleet.

The case for a purpose-built tool gets stronger as:
- Your number of customers grows (multi-tenancy becomes the bottleneck)
- The fraction of customers on Windows grows
- You start losing deals to MSPs offering microsegmentation or threat hunting
- Your customers start asking for evidence of security posture, not just patching status
- You have customers stuck on EOL Windows that the RMM can't help with

If two or three of those apply, the maths above starts pointing in one direction.

## The bigger shift

The deeper change is that "endpoint security" stopped being a thing you buy from your antivirus vendor and started being a thing you run as a managed practice. Patching, posture management, microsegmentation, hunting, reporting — these are now operations, not products. The MSPs winning new business in 2026 are the ones who can show a prospect a real monthly report with real numbers from a real customer fleet, not a brochure from CrowdStrike.

The tooling has finally caught up to that reality. Whether you build it yourself with PowerShell on top of your RMM, buy a full EDR, or pick a Defender-centric platform — the question is no longer whether to do it, but how cleanly you can run it as a service.
