---
title: "Windows 10 end of life is here — what SMBs should actually do"
description: "Microsoft stopped patching Windows 10 in October 2025. Most SMB advice is to upgrade or pay for ESU. Here's the honest third option for boxes that can't move."
publishedAt: "2026-01-14"
updatedAt: "2026-05-29"
author: "Shane Stephens"
category: "Legacy Windows"
---

On 14 October 2025, Microsoft stopped shipping free security updates for Windows 10. The official advice is straightforward: upgrade to Windows 11, or pay for Extended Security Updates (ESU) — currently US $61 per device for year one for businesses, doubling every year, with a three-year cap. For an SMB with 80 mixed endpoints, the all-up cost of ESU across three years sits north of AU $30,000 once you add tax and exchange.

If you can move every endpoint to Windows 11, that's the right answer. This post isn't for you.

This post is for the other case: the SMB or MSP that has 20, 50, sometimes 200 endpoints stuck on Windows 10 because the hardware doesn't meet Windows 11's TPM/CPU requirements, because the line-of-business app vendor hasn't certified Win11 yet, or because the budget for a full hardware refresh isn't there in this financial year. That fleet is now running an unpatched operating system on the internet. What do you actually do?

## The honest landscape

There are four genuine options, and most posts about EOL Windows pretend there are only two.

1. **Upgrade in place.** Free, ideal, but only works on TPM 2.0 hardware with a supported CPU. Microsoft's PC Health Check tool will tell you per-box. For older fleets, this typically covers maybe 40-60% of devices.
2. **Buy ESU.** Patches keep flowing for up to three more years. Cost is significant, and at the end of three years you're in the same position.
3. **Buy new hardware.** Capex hit, but you get a fresh 5-year window and Windows 11 security primitives like VBS, HVCI, and TPM-backed credential protection.
4. **Compensate at the network and host level.** Accept that Microsoft isn't patching the kernel and aggressively reduce what an attacker can do _after_ they land on the box. This is what enterprises with mainframes and OT have been doing for 30 years. It's a legitimate strategy if you do it properly.

Option 4 doesn't get talked about because it's harder to sell — there's no SKU, no checkbox, no audit-friendly receipt. But for the boxes that genuinely can't move, it's the difference between "negligent" and "defensible."

## What "compensate at host level" actually means

The threat model on an EOL Windows 10 box is approximately: a remotely exploitable kernel vulnerability lands in the wild, your box gets attacked over SMB, RDP, or a malicious document, an attacker gains SYSTEM, and then they pivot. Each of those steps has practical mitigations that don't depend on Microsoft shipping a patch.

**Cut the inbound attack surface.** Most lateral-movement protocols — SMB, RDP, WinRM, NetBIOS — are wide open by default because they need to be for normal Windows behaviour. They almost never need to be open to _every other host on the LAN_. Microsegmentation at the Windows Firewall layer (not the network layer — that's harder) lets you say "this finance workstation accepts SMB from the file server and nothing else." When the kernel exploit drops, an attacker who lands on Reception's PC discovers they can't even reach Accounting's PC over the network.

The mechanics: Windows has had an excellent host firewall since Vista. The only reason it doesn't help is that nobody configures it past "Domain/Private/Public profiles." You can write rules that say "allow inbound TCP 445 only from 10.0.1.5" and Windows will enforce them. The hard part is figuring out which rules you actually need without breaking line-of-business apps. The standard approach is a learn-mode period — log every connection the box makes for a few days — then promote the observed pattern into enforced rules.

**Lock the boot path.** Application allow-listing (WDAC) and constrained PowerShell language mode close off the two paths most malware uses: dropping an unsigned binary and running it, or living off the land with PowerShell. WDAC has been free in Windows for years and almost no one uses it because the policy authoring is painful. There are tooling shortcuts — even an audit-mode policy that tells you what would have been blocked is more telegraphy than most boxes get today.

**DNS-level filtering.** Most malware needs to call out to a C2 server. If your endpoints can only resolve DNS through a filter that drops known-bad domains (Quad9, NextDNS, AdGuard Home, your DNS provider's threat feed), you've killed a significant fraction of post-exploitation. This works the same on Windows 10 EOL as on a brand-new Windows 11 box.

**Behaviour monitoring through Defender.** Even on Windows 10, the antivirus engine is still receiving cloud-delivered signature updates after the OS itself stops getting patches. Microsoft is reasonably explicit about this — the [Defender Antimalware Platform](https://learn.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-antivirus/microsoft-defender-antivirus-on-windows-server) update channel keeps moving. Make sure cloud-protection is on, real-time protection is on, and behaviour monitoring is on. None of these require an E5 license.

**Logging.** When the inevitable happens, you need to know what occurred. Forward Defender events, security events, and PowerShell script-block logging somewhere centralised. Even simple file-based forwarding via a scheduled task works. Without logs, your incident response will be 90% guessing.

## A practical plan for the next 90 days

If you have an EOL Windows 10 fleet you can't move:

1. **Inventory the boxes by reason.** "Can't move because CPU/TPM" vs "can't move because LOB app" vs "can move but haven't gotten to it." The third category is your free win — schedule it.
2. **Patch the apps even if you can't patch the OS.** Browsers, Office, Adobe, Java — these get exploited far more than kernel CVEs. Make sure every internet-facing app is being kept current.
3. **Turn on the Defender knobs that don't cost anything.** Cloud-delivered protection, behaviour monitoring, network protection, controlled folder access. Microsoft documents these well; the issue is usually that they were never turned on, not that they don't work.
4. **Do a microsegmentation audit.** For 30 days, log every inbound connection on the EOL boxes. Most fleets discover their EOL boxes are accepting connections from 90% of the LAN that they never use. Cut those.
5. **Lock down outbound DNS.** Point endpoints at a filtering resolver. Block direct DNS to 8.8.8.8, 1.1.1.1, etc. — make them go through your filter.
6. **Schedule the eventual migration.** Whatever the compensating controls, you're on borrowed time. Get the capex into next year's budget. Document the risk in your security register.

## Where Mithras fits

We built Mithras specifically because this problem doesn't have a tidy answer and the SMB market is full of people trying to do option 4 on their own. The platform centrally manages Defender posture on Windows 7 SP1 onward, builds the microsegmentation ruleset by observing live traffic, ships a DNS-filtering module, and writes the application-control policy alongside it. It's not magic — there is no software-only answer to a kernel CVE that Microsoft chose not to patch — but it's the difference between a defensible posture and a hopeful one.

If you're staring down a fleet of EOL Windows 10 boxes, the first thing to do is to be honest with yourself about which boxes genuinely can't move and which ones just haven't been moved yet. Once you've done that triage, the second thing is to stop pretending compensating controls aren't a real strategy. Done well, they are.

The third thing, of course, is to actually schedule the upgrade. Borrowed time runs out.
