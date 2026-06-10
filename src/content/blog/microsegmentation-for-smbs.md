---
title: "Microsegmentation for SMBs that don't have a network engineer"
description: "Microsegmentation is the single highest-impact ransomware control after backups. Here's how to do it on Windows endpoints without a VLAN refresh or a network team."
publishedAt: "2026-03-11"
updatedAt: "2026-05-29"
author: "Shane Stephens"
category: "Microsegmentation"
---

The first time most SMBs hear the word "microsegmentation" is in a post-ransomware incident review. The forensics report says something like: _the initial compromise was Reception's workstation; the attacker moved laterally to the file server via SMB and to the domain controller via WMI; encryption began at 02:14 AM_. The recommendation that follows is invariably some variant of "segment your network so this kind of lateral movement is harder."

The advice is correct. The implementation guide that usually goes with it — buy a NAC product, redesign your VLANs, route everything through a firewall, install agents from a $50,000/year vendor — is fine for the Fortune 500 and irrelevant to the SMB with 80 endpoints and a flat /24.

You don't need a network refresh to materially reduce lateral movement. You need to use the host firewall that's already on every Windows endpoint, and configure it properly. This post is about how to do that without a network engineer.

## What microsegmentation actually is

In the enterprise sense, microsegmentation means: every workload only accepts traffic from the specific peers and ports it needs to do its job. Reception's PC doesn't accept SMB from Accounting's PC because Reception's PC doesn't need to. When malware lands on Reception's PC, half of its options for lateral movement are off the table because the other endpoints simply refuse the connection.

In SMB terms: 90% of the lateral-movement protocols Windows uses by default (SMB on 445, RDP on 3389, WinRM on 5985-5986, RPC on 135, NetBIOS on 137-139) are open to every other host on your LAN. Almost none of them need to be. You can lock them down to specific source IPs at the host firewall, and you don't need a single network change.

## Why not network segmentation instead

Three reasons.

First, network segmentation requires VLANs, inter-VLAN routing, and a stateful firewall between every segment pair. For most SMBs that's a forklift of the LAN — months of work, real money, and a window of disruption.

Second, network segmentation operates at the network layer. It's blind to "this user got a phishing email and downloaded a Word document with a macro that spawned PowerShell." The malware is already on the box. Network segmentation matters only at the moment the box tries to reach another box — which is the right level for lateral movement, but it's coarse.

Third, host-based microsegmentation can be _learned_ from observed traffic. You can't do that with a network firewall without packet inspection that most SMB-class firewalls don't do well. The host firewall sees every connection initiated and accepted; it knows which app, which user, which port, every time.

The two approaches are complementary, not competing. If you have proper network segmentation, do it. If you don't, host-based microsegmentation gets you most of the lateral-movement reduction for a tiny fraction of the cost.

## The mechanics

Windows Firewall — properly named "Windows Defender Firewall with Advanced Security" since Vista — supports rules with specific source IPs, ports, protocols, and applications. The PowerShell cmdlets are stable and well-documented.

The simplest "block lateral movement" rule, applied to a workstation:

```powershell
New-NetFirewallRule -DisplayName 'Block inbound SMB from non-server hosts' `
                    -Direction Inbound -Action Block `
                    -Protocol TCP -LocalPort 445 `
                    -RemoteAddress 10.0.0.0/24 `
                    -Profile Domain,Private -Enabled True
```

But you don't want to write 50 of these by hand, and you definitely don't want to write them blind. The right approach has three steps.

### Step 1: Learn

For a week, log every inbound connection that gets accepted on the host. Don't block anything yet. Windows can do this natively via firewall logging:

```powershell
Set-NetFirewallProfile -Profile Domain,Private,Public -LogAllowed True -LogBlocked True `
                       -LogFileName "%systemroot%\system32\LogFiles\Firewall\pfirewall.log"
```

After a week, parse the log and group by remote IP + port. You will see, very quickly, that 95% of the inbound SMB on a typical workstation comes from one or two file servers, and the rest is broadcast noise. The 95% is your allow rule; the noise is what you're cutting.

### Step 2: Generate the ruleset

For each `(remote_ip, port)` pair you observed, write an allow rule. For everything else on that port, block. The cleanest way to express this is one allow-list per protocol:

```powershell
# Allow SMB only from the file server.
New-NetFirewallRule -DisplayName 'Allow SMB from FS01' -Direction Inbound -Action Allow `
                    -Protocol TCP -LocalPort 445 -RemoteAddress 10.0.1.5 -Enabled True

# Block everything else on 445.
New-NetFirewallRule -DisplayName 'Block SMB by default' -Direction Inbound -Action Block `
                    -Protocol TCP -LocalPort 445 -Enabled True
```

Order matters in concept but not in Windows Firewall implementation — rules are evaluated against a precedence (block > allow > by default), so the more specific allow wins.

Repeat for RDP, WinRM, RPC, NetBIOS. Do not block RPC on 135 outright — it breaks things you don't expect — but block the dynamic port range (`49152-65535`) from anywhere you don't have a specific allow.

### Step 3: Enforce, then iterate

Switch the rules to enforced. Tell users that if something breaks, log it. Watch the firewall log for blocked connections that turn out to be legitimate, add allow rules, repeat.

Most SMB fleets reach a steady state inside two weeks. The first day after enforcement you'll get a flurry of "the printer isn't working" tickets and you'll discover that print discovery was happening over a protocol nobody mentioned in any vendor doc. After that, the system is stable.

## What this changes for an attacker

The empirical evidence from incident response is that microsegmented endpoints reduce successful lateral movement by roughly an order of magnitude. The attacker still gets onto Reception's PC. They still have local-admin or SYSTEM. But when they enumerate the network and start spraying credentials at SMB shares, RDP endpoints, and WMI services, the targets refuse the connection at the firewall layer before the credentials are even processed.

This doesn't stop everything. An attacker on the file server itself can still reach everyone who needs the file server. An attacker who phishes IT staff and gets a domain admin credential still wins. But the long tail of "attacker got onto an ordinary workstation and pivoted to ten other ordinary workstations" — which is the dominant pattern in ransomware — gets very hard.

## The practical problem

The reason most SMBs don't do this isn't that the mechanics are difficult; it's that nobody has time to spend three weeks per endpoint learning traffic patterns and writing rules. The maintenance is also non-trivial: new applications introduce new connection patterns, and you have to keep the ruleset current as the environment changes.

That's the gap Mithras's microsegmentation module fills: the agent collects the learn-mode traffic data automatically, the platform proposes a ruleset based on what it observed, you review and approve, and the platform pushes the rules. New traffic patterns get flagged so you can decide whether to allow or investigate. The same pipeline runs on every endpoint, so a 200-machine fleet is no more work than a 20-machine one.

But whether you use a platform or do it by hand: do it. Of the security investments an SMB can make for under AU $10,000, host-based microsegmentation has the highest measurable impact on ransomware blast radius. Backups give you recovery; microsegmentation reduces the amount you need to recover from. They work together, and most SMBs only have one of them.
