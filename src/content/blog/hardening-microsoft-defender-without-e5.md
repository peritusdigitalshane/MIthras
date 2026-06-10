---
title: "Hardening Microsoft Defender without paying for E5"
description: "Defender for Business and the free Defender that ships with Windows 11 Pro are more capable than most SMBs realise. Here's exactly what to turn on."
publishedAt: "2026-02-04"
updatedAt: "2026-05-29"
author: "Shane Stephens"
category: "Microsoft Defender"
---

The Microsoft licensing site implies you need Microsoft 365 E5 — about AU $87 per user per month at retail — to get serious endpoint protection. That sticker price is the single most common reason small businesses end up running a third-party EDR they don't fully use, or worse, running Defender with all the cloud features turned off because nobody told them they were free.

Here's the actual licensing landscape for Defender features on Windows 10/11 Pro and Windows Server, with the bits you can turn on today at no extra cost.

## What you already have

If your endpoint is running Windows 10/11 Pro or Windows Server, Microsoft Defender Antivirus is already installed. The engine and signatures are kept current through Windows Update and the [malware platform update channel](https://learn.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-antivirus/microsoft-defender-antivirus-on-windows-server), and they're free.

What you don't get without an EDR licence: per-process telemetry centralised to Microsoft's cloud (that's Defender for Endpoint), full Live Response, advanced hunting queries, automated investigation and response. What you _do_ get: a fully functional antivirus, cloud-delivered signature and behavioural protection, controlled folder access, network protection, attack surface reduction rules, and Windows Defender Application Control. That's a lot.

The mistake we see repeatedly is that these settings are off by default or buried in Group Policy paths nobody touches. Turn them on and the gap to a paid EDR narrows considerably.

## The settings that matter, in order

### 1. Cloud-delivered protection — on

The Defender engine on the local box can only see what its signatures know about. With cloud-delivered protection on, the engine sends file hashes and behavioural signals to Microsoft's cloud and gets sub-second verdicts back — including on samples that haven't been signature-classified yet. This catches a huge fraction of "new" malware before it executes.

PowerShell:

```powershell
Set-MpPreference -MAPSReporting Advanced
Set-MpPreference -SubmitSamplesConsent SendSafeSamples
Set-MpPreference -CloudBlockLevel High
Set-MpPreference -CloudExtendedTimeout 50
```

`CloudBlockLevel High` is the right default for most SMB workloads. It accepts a small false-positive risk for materially better catch rates on fresh threats. `High Plus` is more aggressive; `Zero Tolerance` is for high-trust admin endpoints only.

### 2. Behaviour monitoring — on

```powershell
Set-MpPreference -DisableBehaviorMonitoring $false
Set-MpPreference -DisableScriptScanning $false
Set-MpPreference -DisableIOAVProtection $false
```

This is what turns "AV that scans files when you open them" into "AV that notices a Word document spawning PowerShell which downloads a binary which executes." Behaviour monitoring is the closest thing Defender has to a free EDR.

### 3. Attack Surface Reduction rules

ASR is a set of about 20 named rules that block common attack techniques — Office macros writing executables, child processes of email clients, USB-based credential theft, etc. They're managed independently of signature updates and they're free.

The rules to set to `Block` (not `AuditMode`) on a typical SMB endpoint:

| Rule GUID | What it blocks |
|---|---|
| `D4F940AB-401B-4EFC-AADC-AD5F3C50688A` | Office apps creating child processes |
| `D3E037E1-3EB8-44C8-A917-57927947596D` | JavaScript/VBScript launching downloaded executables |
| `BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550` | Office macros importing Win32 calls |
| `9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2` | Credential stealing from LSASS |
| `B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4` | Untrusted USB processes |
| `26190899-1602-49E8-8B27-EB1D0A1CE869` | Office communications app child processes |
| `D1E49AAC-8F56-4280-B9BA-993A6D77406C` | PSExec and WMI commands from script |

```powershell
Add-MpPreference -AttackSurfaceReductionRules_Ids `
  'D4F940AB-401B-4EFC-AADC-AD5F3C50688A','D3E037E1-3EB8-44C8-A917-57927947596D' `
  -AttackSurfaceReductionRules_Actions Block,Block
```

Set everything in `AuditMode` first and watch the event log for a week — turn rules to `Block` once you've satisfied yourself that nothing legitimate is being tripped. The events land in `Microsoft-Windows-Windows Defender/Operational` with event IDs 1121 (block) and 1122 (audit).

### 4. Controlled folder access

Stops untrusted processes writing to your Documents, Pictures, Desktop, and any folders you add. The best free ransomware mitigation on a Windows endpoint that isn't backups.

```powershell
Set-MpPreference -EnableControlledFolderAccess Enabled
Add-MpPreference -ControlledFolderAccessProtectedFolders 'C:\Critical\Path'
```

Test it in `AuditMode` first; some legitimate apps will need to be added to the allowed-applications list.

### 5. Network protection

Blocks outbound connections to known-bad URLs and IPs based on Microsoft's reputation feed. Same logic as SmartScreen but applied at the network layer, so it works for any process — not just browsers.

```powershell
Set-MpPreference -EnableNetworkProtection Enabled
```

### 6. PUA protection

Potentially Unwanted Application protection blocks adware, bundleware, and the long tail of borderline-malware that gets onto endpoints through "free" download sites.

```powershell
Set-MpPreference -PUAProtection Enabled
```

### 7. Tamper protection

Stops local administrators (including malware running as admin) from disabling Defender. On consumer Windows it's in Settings; for managed fleets it's set via Intune or via the registry under HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Features\TamperProtection (DWORD, value 5 = on). Note that tamper protection itself requires cloud-delivered protection to be enabled, and on Windows 11 Pro is on by default — but verify, don't trust.

## The settings that need GPO/Intune (still free)

Some of the strongest Defender controls aren't reachable through PowerShell on a domain-joined box because they're meant to be set as policy. Set these via Group Policy (Computer Configuration → Administrative Templates → Windows Components → Microsoft Defender Antivirus):

- **Configure detection for potentially unwanted applications**: Enabled, Block.
- **Turn on definition retirement**: Disabled. (Keeps older signatures active.)
- **Disable local admin merge**: Enabled. (Stops local admins overriding policy.)
- **Configure the 'Block at First Sight' feature**: Enabled.

## What you don't get without a licence

Be honest about the gap.

Defender for Business (~AU $4.50/user/month) adds: a Microsoft 365 Defender console where you see all endpoints in one place, advanced hunting queries on a 30-day history, automated investigation and response, and threat & vulnerability management. If you have ten or fewer endpoints, the free configuration above gets you 80% of the way; if you have more than that, the management overhead of doing it per-box outweighs the licence cost.

Defender for Endpoint P1/P2 / E5 adds longer hunting windows, richer telemetry, attack disruption, and the Microsoft Threat Experts service. Worth it for large fleets with internal SOC capability; rarely worth it for SMBs.

## The other option

What we built Mithras for: managing all of the above settings centrally on Windows endpoints, in a multi-tenant console, without making you pay for E5 or even Defender for Business. The platform pushes the PowerShell and registry settings above as policies, monitors compliance, and surfaces an endpoint's actual posture next to what you told it to be. You stay on free Defender; you get the central management.

If you're managing more than five endpoints by hand today, the issue isn't whether the settings work — it's that you can't be sure they're set on every box, every day, after every reboot. That's a management problem, not a licensing problem.

Either way: turn the settings above on. They're free, they work, and most boxes don't have them set.
