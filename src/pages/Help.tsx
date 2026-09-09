import { MainLayout } from "@/components/layout/MainLayout";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Shield, Monitor, FileText, Network, Router, SlidersHorizontal,
  AlertTriangle, Search, BookOpen, Lightbulb, ArrowRight, CheckCircle2,
  ShieldAlert, Bell, Crosshair, ClipboardList, Activity, Users, Settings,
  FolderOpen, Download, ScrollText, Sparkles, Lock, Eye, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HelpSection {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  articles: HelpArticle[];
}

interface HelpArticle {
  title: string;
  content: string;
  bestPractice?: string;
  recommendedValue?: string;
  severity?: "critical" | "high" | "medium" | "low";
}

const helpSections: HelpSection[] = [
  {
    id: "defender",
    title: "Defender Policies",
    icon: Shield,
    description: "Windows Defender antivirus settings and Attack Surface Reduction rules",
    articles: [
      {
        title: "Real-Time Monitoring",
        content: "Continuously scans files as they are accessed, created, or modified. This is the primary layer of defense against malware executing on endpoints.",
        bestPractice: "Always keep enabled. Only disable temporarily for known-safe software installations that trigger false positives.",
        recommendedValue: "Enabled",
        severity: "critical",
      },
      {
        title: "Cloud-Delivered Protection",
        content: "Sends suspicious file metadata to Microsoft's cloud for real-time analysis. Provides protection against zero-day threats within seconds rather than waiting for signature updates.",
        bestPractice: "Enable on all endpoints with internet access. Pair with Block at First Seen for maximum protection.",
        recommendedValue: "Enabled",
        severity: "critical",
      },
      {
        title: "Block at First Seen (BAFS)",
        content: "Blocks new, never-before-seen files until the cloud delivers a verdict. Works with Cloud-Delivered Protection to stop zero-day malware.",
        bestPractice: "Enable alongside Cloud-Delivered Protection. May cause brief delays when opening rare executables.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "Cloud Block Level",
        content: "Controls the aggressiveness of cloud-based blocking. Higher levels block more suspicious files but increase false positive risk. Levels: Default, Moderate, High, High+, Zero Tolerance.",
        bestPractice: "Use 'High' for most environments. Use 'High+' or 'Zero Tolerance' for high-security environments where false positives are acceptable.",
        recommendedValue: "High",
        severity: "high",
      },
      {
        title: "Cloud Extended Timeout",
        content: "How long (in seconds) Defender waits for a cloud verdict before allowing a file. Default is 10 seconds. Range: 0–50 seconds.",
        bestPractice: "Set to 50 seconds for maximum protection. Users may experience brief delays opening unknown files.",
        recommendedValue: "50 seconds",
        severity: "medium",
      },
      {
        title: "Behavior Monitoring",
        content: "Monitors running processes for suspicious behavior patterns like injection, privilege escalation, or ransomware-like file encryption.",
        bestPractice: "Always enable. This catches threats that signature-based detection misses.",
        recommendedValue: "Enabled",
        severity: "critical",
      },
      {
        title: "Network Protection",
        content: "Blocks connections to known malicious domains and IP addresses. Prevents phishing, exploit kits, and command-and-control communications.",
        bestPractice: "Enable on all endpoints. Review blocked connections in Event Logs to identify potential compromises.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "PUA Protection (Potentially Unwanted Applications)",
        content: "Detects and blocks adware, bundleware, and other potentially unwanted software that isn't strictly malware but degrades security or performance.",
        bestPractice: "Enable to prevent bloatware and toolbars. Review detections before allowing exceptions.",
        recommendedValue: "Enabled",
        severity: "medium",
      },
      {
        title: "Controlled Folder Access",
        content: "Prevents unauthorized applications from modifying files in protected folders (Documents, Desktop, etc.). Primary defense against ransomware.",
        bestPractice: "Enable in Audit mode first to identify legitimate apps that need access. Then switch to Block mode and add necessary exclusions.",
        recommendedValue: "Enabled (after audit period)",
        severity: "high",
      },
      {
        title: "Exploit Protection",
        content: "Applies exploit mitigation techniques (DEP, ASLR, CFG) to processes. Hardens applications against memory corruption attacks.",
        bestPractice: "Enable globally. Test with critical business applications first as some legacy apps may be incompatible.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "Signature Update Interval",
        content: "How often (in hours) Defender checks for new antivirus definitions. More frequent updates mean faster protection against newly discovered threats.",
        bestPractice: "Set to 1 hour for internet-connected endpoints. For air-gapped systems, use manual WSUS updates.",
        recommendedValue: "1 hour",
        severity: "medium",
      },
      {
        title: "Exclusion Paths / Extensions / Processes",
        content: "Files, folders, extensions, or processes excluded from scanning. Necessary for performance with some applications but creates security blind spots.",
        bestPractice: "Minimize exclusions. Document every exclusion with a business justification. Never exclude common malware paths (Temp, AppData, Downloads). Review quarterly.",
        recommendedValue: "As few as possible",
        severity: "high",
      },
    ],
  },
  {
    id: "asr",
    title: "Attack Surface Reduction (ASR) Rules",
    icon: ShieldAlert,
    description: "Rules that block common attack techniques used by malware and exploits",
    articles: [
      {
        title: "ASR Rules Overview",
        content: "ASR rules target specific behaviors commonly used in attacks. Each rule can be set to Disabled, Audit, Warn, or Block. Audit mode logs events without blocking, allowing you to assess impact before enforcement.",
        bestPractice: "Deploy all rules in Audit mode for 2-4 weeks. Review audit events in Event Logs to identify legitimate applications that would be blocked. Add exclusions for those apps, then switch to Block mode.",
        severity: "critical",
      },
      {
        title: "Block Office apps from creating child processes",
        content: "Prevents Office applications (Word, Excel, PowerPoint) from launching other executables. Blocks a very common malware delivery technique where a malicious macro spawns PowerShell or cmd.exe.",
        bestPractice: "Block mode recommended for all environments. Very few legitimate Office workflows need to launch external processes.",
        recommendedValue: "Block",
        severity: "critical",
      },
      {
        title: "Block Office apps from injecting code",
        content: "Prevents Office apps from injecting code into other processes. Stops fileless malware that uses Office as an injection vector.",
        bestPractice: "Block mode. This rarely impacts legitimate software.",
        recommendedValue: "Block",
        severity: "critical",
      },
      {
        title: "Block credential stealing from LSASS",
        content: "Prevents processes from accessing the LSASS process memory, which stores authentication credentials. Blocks tools like Mimikatz.",
        bestPractice: "Block mode. Combine with Credential Guard for defense-in-depth. Essential for preventing lateral movement.",
        recommendedValue: "Block",
        severity: "critical",
      },
      {
        title: "Block executable content from email",
        content: "Prevents executable files and scripts delivered via email clients (Outlook) from running.",
        bestPractice: "Block mode. Users should never need to run executables directly from email.",
        recommendedValue: "Block",
        severity: "high",
      },
      {
        title: "Block obfuscated scripts",
        content: "Detects and blocks scripts that use obfuscation techniques to hide malicious intent. Targets encoded PowerShell, VBScript, and JavaScript.",
        bestPractice: "Start in Audit mode if you have PowerShell-heavy automation. Block mode once you've verified no impact on legitimate scripts.",
        recommendedValue: "Block (after audit)",
        severity: "high",
      },
      {
        title: "Block JavaScript/VBScript from launching executables",
        content: "Prevents script engines from downloading and executing payloads. Common vector for drive-by downloads and malvertising.",
        bestPractice: "Block mode. Web-based scripts should not need to launch local executables.",
        recommendedValue: "Block",
        severity: "high",
      },
      {
        title: "Advanced Ransomware Protection",
        content: "Uses machine learning and cloud intelligence to identify and block ransomware behavior patterns, even from previously unseen variants.",
        bestPractice: "Block mode. Requires Cloud-Delivered Protection to be enabled for full effectiveness.",
        recommendedValue: "Block",
        severity: "critical",
      },
      {
        title: "Block process creation from PSExec and WMI",
        content: "Prevents remote process execution via PSExec and WMI commands. Blocks common lateral movement techniques.",
        bestPractice: "Audit first — many IT management tools use WMI. Block if your environment doesn't rely on WMI-based remote management.",
        recommendedValue: "Audit → Block",
        severity: "high",
      },
      {
        title: "Block untrusted/unsigned processes from USB",
        content: "Prevents unsigned or untrusted executables from running directly from USB drives.",
        bestPractice: "Block mode. Users should install software from approved sources, not USB drives.",
        recommendedValue: "Block",
        severity: "medium",
      },
      {
        title: "Block exploitation of vulnerable signed drivers",
        content: "Prevents loading of known-vulnerable kernel drivers that attackers exploit for privilege escalation (BYOVD attacks).",
        bestPractice: "Block mode. Keep the driver block list updated.",
        recommendedValue: "Block",
        severity: "critical",
      },
    ],
  },
  {
    id: "wdac",
    title: "Application Control (WDAC)",
    icon: Lock,
    description: "Windows Defender Application Control for whitelisting trusted applications",
    articles: [
      {
        title: "What is WDAC?",
        content: "Windows Defender Application Control (WDAC) restricts which applications can run on endpoints. Unlike traditional antivirus that blocks known-bad software, WDAC only allows known-good software — a fundamentally stronger security model.",
        bestPractice: "WDAC is the gold standard for endpoint protection. Follow the deployment workflow below carefully to avoid disruption.",
        severity: "critical",
      },
      {
        title: "Rule Sets",
        content: "Rule Sets are collections of allow/block rules organized by purpose (e.g., 'Standard Office Apps', 'Developer Tools'). Each rule can match by Publisher, File Name, File Path, or Hash. Multiple Rule Sets can be assigned to endpoint groups with priority ordering.",
        bestPractice: "Create focused Rule Sets by application category. Start with a 'Base OS' set and add application-specific sets as needed.",
        severity: "high",
      },
      {
        title: "Publisher Rules",
        content: "Trust all software signed by a specific publisher certificate. The broadest and most maintainable rule type — automatically covers updates from the same publisher.",
        bestPractice: "Use publisher rules for major software vendors (Microsoft, Adobe, etc.). This avoids updating rules every time software is patched.",
        recommendedValue: "Primary rule type",
        severity: "high",
      },
      {
        title: "Audit vs Enforced Mode",
        content: "Audit mode logs which applications would be blocked without actually blocking them. Enforced mode actively prevents unauthorized applications from running.",
        bestPractice: "ALWAYS start in Audit mode. Never go directly to Enforced mode in production.",
        severity: "critical",
      },
      {
        title: "Discovered Apps",
        content: "The Discovered Apps view shows all executables detected running on your endpoints. From here you can quickly create allow rules for legitimate applications before switching to Enforced mode.",
        bestPractice: "Review Discovered Apps weekly during the audit period. Sort by 'not covered by any rule' to find gaps.",
        severity: "medium",
      },
      {
        title: "Trust All Publishers",
        content: "A convenience feature that creates publisher-based allow rules for all currently known publishers in one action. Useful for establishing an initial baseline.",
        bestPractice: "Use when first onboarding a group to quickly create a baseline. Review the generated rules afterward to remove any unwanted publishers.",
        severity: "medium",
      },
    ],
  },
  {
    id: "wdac-workflow",
    title: "WDAC Deployment Workflow",
    icon: ArrowRight,
    description: "Step-by-step guide to safely deploying application whitelisting",
    articles: [
      {
        title: "Step 1: Create an Endpoint Group",
        content: "Start by organizing your endpoints into logical groups (e.g., by department or role). Navigate to Groups and create a new group, then assign the target endpoints.",
        bestPractice: "Start with a small pilot group (5-10 machines) of representative users. Include a mix of roles to capture diverse application usage.",
        severity: "high",
      },
      {
        title: "Step 2: Create a Rule Set in Audit Mode",
        content: "Go to Policies → WDAC Rule Sets → Create Rule Set. Set the mode to 'Audit'. Add initial rules for your known software (OS components, Office, LOB apps). Assign it to your pilot group.",
        bestPractice: "Start with publisher rules for Microsoft, your antivirus vendor, and any major LOB application publishers.",
        severity: "high",
      },
      {
        title: "Step 3: Monitor Discovered Apps (2-4 weeks)",
        content: "Let the audit run for 2-4 weeks to capture all applications users run. Check Policies → Discovered Apps regularly. Look for applications that aren't covered by your rules.",
        bestPractice: "Wait for at least one full business cycle (month-end, quarterly reports) to catch infrequently used applications. Check Event Logs for audit events.",
        severity: "critical",
      },
      {
        title: "Step 4: Build Out Allow Rules",
        content: "From Discovered Apps, create allow rules for all legitimate applications. Use 'Trust All Publishers' for the initial bulk, then review individual files without publisher signatures.",
        bestPractice: "Prefer publisher rules → file name rules → path rules → hash rules (in order of maintainability). Hash rules break on every update.",
        severity: "high",
      },
      {
        title: "Step 5: Switch to Enforced Mode",
        content: "Once you're confident all legitimate apps are covered, change the Rule Set mode from Audit to Enforced. Monitor closely for the first week.",
        bestPractice: "Switch during low-activity periods. Have a plan to quickly revert to Audit mode if issues arise. Communicate the change to affected users.",
        severity: "critical",
      },
      {
        title: "Step 6: Expand to More Groups",
        content: "After successful enforcement on the pilot group, gradually expand to other endpoint groups. You can reuse Rule Sets across groups or create group-specific ones.",
        bestPractice: "Roll out in waves: pilot → IT staff → general office → critical systems. Each wave should have its own 1-2 week audit period.",
        severity: "medium",
      },
      {
        title: "Step 7: Ongoing Maintenance",
        content: "Regularly review Discovered Apps for new software. When users report blocked applications, evaluate and add rules as appropriate. Monitor WDAC Endpoints for compliance.",
        bestPractice: "Establish a change request process: users request app approval → admin reviews → rule added. Review and prune unused rules quarterly.",
        severity: "medium",
      },
    ],
  },
  {
    id: "gpo",
    title: "Group Policy Settings",
    icon: SlidersHorizontal,
    description: "Windows Group Policy configuration for password, audit, security, and system settings",
    articles: [
      {
        title: "Password Policy — Minimum Length",
        content: "Sets the minimum number of characters required for user passwords. Longer passwords are exponentially harder to crack.",
        bestPractice: "14+ characters for standard users, 16+ for admins. Modern guidance (NIST SP 800-63B) favors length over complexity.",
        recommendedValue: "14 characters",
        severity: "critical",
      },
      {
        title: "Password Policy — Complexity",
        content: "Requires passwords to contain uppercase, lowercase, numbers, and symbols. While traditional, this alone doesn't guarantee strong passwords.",
        bestPractice: "Enable alongside a long minimum length. Consider passphrases (e.g., 'correct-horse-battery-staple') which are both long and memorable.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "Password Policy — Maximum Age",
        content: "Forces password changes after a set number of days. NIST now recommends against mandatory rotation unless a breach is suspected.",
        bestPractice: "Set to 365 days or disable if using MFA. Frequent forced changes lead to weaker passwords (Password1!, Password2!, etc.).",
        recommendedValue: "365 days (with MFA)",
        severity: "medium",
      },
      {
        title: "Password Policy — History Count",
        content: "Prevents reuse of recent passwords. Users must use unique passwords for the specified number of changes.",
        bestPractice: "Set to 24 to prevent cycling back to old passwords.",
        recommendedValue: "24 passwords remembered",
        severity: "medium",
      },
      {
        title: "Account Lockout — Threshold",
        content: "Locks the account after a set number of failed login attempts. Protects against brute-force attacks.",
        bestPractice: "5 attempts is a good balance between security and usability. Too low causes lockouts from typos.",
        recommendedValue: "5 attempts",
        severity: "high",
      },
      {
        title: "Account Lockout — Duration",
        content: "How long (in minutes) an account stays locked after exceeding the threshold. Setting to 0 requires admin unlock.",
        bestPractice: "15-30 minutes for self-service unlock. Use 0 (manual unlock) for privileged accounts.",
        recommendedValue: "30 minutes",
        severity: "medium",
      },
      {
        title: "Audit Policy — Logon Events",
        content: "Records successful and failed logon attempts. Essential for detecting brute-force attacks and unauthorized access.",
        bestPractice: "Enable Success and Failure auditing. Review failed logons daily for patterns.",
        recommendedValue: "Success and Failure",
        severity: "critical",
      },
      {
        title: "Audit Policy — Account Management",
        content: "Logs creation, modification, and deletion of user accounts and groups. Critical for tracking privilege changes.",
        bestPractice: "Enable Success and Failure. Alert on unexpected account creation or group membership changes.",
        recommendedValue: "Success and Failure",
        severity: "critical",
      },
      {
        title: "Audit Policy — Object Access",
        content: "Tracks access to files, folders, and registry keys. Can generate high log volume.",
        bestPractice: "Enable Failure auditing at minimum. Enable Success only for sensitive file shares with specific SACLs configured.",
        recommendedValue: "Failure (Success selective)",
        severity: "medium",
      },
      {
        title: "Audit Policy — Policy Change",
        content: "Records changes to audit policies, user rights, and trust policies. Detects tampering with security configurations.",
        bestPractice: "Always enable Success and Failure. Any unauthorized policy change is a critical indicator of compromise.",
        recommendedValue: "Success and Failure",
        severity: "critical",
      },
      {
        title: "Interactive Logon — Require Ctrl+Alt+Del",
        content: "Forces users to press Ctrl+Alt+Del before the logon screen appears. Prevents fake logon screen attacks (credential harvesting).",
        bestPractice: "Enable on all domain-joined workstations.",
        recommendedValue: "Enabled",
        severity: "medium",
      },
      {
        title: "Interactive Logon — Don't Display Last Username",
        content: "Hides the username of the last logged-on user from the logon screen. Prevents username enumeration on shared machines.",
        bestPractice: "Enable on shared workstations and kiosks. Less critical for personal assigned machines.",
        recommendedValue: "Enabled (shared machines)",
        severity: "low",
      },
      {
        title: "Remote Desktop — NLA Required",
        content: "Network Level Authentication requires authentication before establishing the RDP session. Prevents unauthenticated resource consumption and reduces attack surface.",
        bestPractice: "Always enable NLA when RDP is enabled. Also limit RDP access via firewall rules.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "Disable Command Prompt / Registry Editor",
        content: "Prevents standard users from opening cmd.exe or regedit. Limits an attacker's ability to run commands or modify the registry after initial access.",
        bestPractice: "Disable for standard users. IT admin accounts should retain access. Test with your user base first.",
        recommendedValue: "Disabled for standard users",
        severity: "medium",
      },
      {
        title: "Telemetry Level",
        content: "Controls what diagnostic data Windows sends to Microsoft. Levels: 0 (Security/off), 1 (Basic), 2 (Enhanced), 3 (Full).",
        bestPractice: "Set to 0 or 1 for privacy-sensitive environments. Note: Level 0 may limit Windows Update functionality.",
        recommendedValue: "1 (Basic)",
        severity: "low",
      },
    ],
  },
  {
    id: "uac",
    title: "UAC Policies",
    icon: Users,
    description: "User Account Control settings that control elevation prompts and admin behavior",
    articles: [
      {
        title: "UAC Enabled",
        content: "Master switch for User Account Control. When enabled, applications must request elevation to perform administrative tasks.",
        bestPractice: "NEVER disable UAC. It is a critical security boundary even for admin users.",
        recommendedValue: "Enabled",
        severity: "critical",
      },
      {
        title: "Admin Consent Prompt Behavior",
        content: "Controls what happens when an admin user tries to elevate. Options: Elevate without prompting (0), Prompt for credentials on secure desktop (1), Prompt for consent on secure desktop (2), Prompt for credentials (3), Prompt for consent (4), Prompt for consent for non-Windows binaries (5).",
        bestPractice: "Set to 2 (Prompt for consent on secure desktop) for convenience with security. Use 1 (Prompt for credentials) for high-security environments.",
        recommendedValue: "2 (Consent on secure desktop)",
        severity: "high",
      },
      {
        title: "Prompt on Secure Desktop",
        content: "Shows the UAC prompt on a separate secure desktop that other applications cannot interact with. Prevents malware from programmatically clicking 'Yes' on UAC prompts.",
        bestPractice: "Always enable. The secure desktop prevents UAC bypass attacks.",
        recommendedValue: "Enabled",
        severity: "high",
      },
      {
        title: "Filter Administrator Token",
        content: "Applies UAC filtering to the built-in Administrator account. By default, the built-in admin bypasses UAC.",
        bestPractice: "Enable to ensure even the built-in Administrator account goes through UAC.",
        recommendedValue: "Enabled",
        severity: "high",
      },
    ],
  },
  {
    id: "windows-update",
    title: "Windows Update Policies",
    icon: Download,
    description: "Control how endpoints receive and install Windows updates",
    articles: [
      {
        title: "Auto Update Mode",
        content: "Controls automatic update behavior. Options: Disabled (1), Notify before download (2), Auto download, notify install (3), Auto download and install (4), Allow local admin to configure (5).",
        bestPractice: "Use mode 3 or 4 for most endpoints. Mode 3 gives admins visibility before installs. Mode 4 installs updates as soon as they're released.",
        recommendedValue: "3 or 4",
        severity: "high",
      },
      {
        title: "Quality Update Deferral",
        content: "Delays cumulative/security updates by the specified number of days. Useful for testing updates before broad deployment.",
        bestPractice: "0-3 days for standard endpoints. 7-14 days for critical servers. Never exceed 30 days — you need security patches.",
        recommendedValue: "3 days",
        severity: "high",
      },
      {
        title: "Feature Update Deferral",
        content: "Delays major Windows feature updates (e.g., 23H2 → 24H2) by the specified number of days.",
        bestPractice: "90-180 days for most organizations. Feature updates carry higher risk of compatibility issues and need thorough testing.",
        recommendedValue: "90 days",
        severity: "medium",
      },
      {
        title: "Active Hours",
        content: "Defines a time range when Windows will not automatically restart for updates. Protects user productivity.",
        bestPractice: "Match to your organization's working hours. Typically 7 AM - 7 PM.",
        recommendedValue: "7:00 - 19:00",
        severity: "medium",
      },
      {
        title: "Pause Updates",
        content: "Temporarily stops all quality or feature updates. Useful when a known-bad update is released.",
        bestPractice: "Only pause when a specific update causes issues. Unpause as soon as a fix is available. Never leave paused indefinitely.",
        recommendedValue: "Not paused (default)",
        severity: "medium",
      },
    ],
  },
  {
    id: "firewall",
    title: "Network Firewall",
    icon: Network,
    description: "Host-based firewall policies and microsegmentation rules",
    articles: [
      {
        title: "Service-Access Matrix",
        content: "A grid view showing which endpoint groups can access which services (RDP, SMB, WinRM, SSH, HTTP/S). Rows are endpoint groups, columns are services.",
        bestPractice: "Start with all services blocked, then explicitly allow only what's needed. This is the principle of least privilege applied to network access.",
        severity: "high",
      },
      {
        title: "Audit vs Enforce Mode",
        content: "Audit mode logs blocked connections without actually blocking them. Enforce mode actively blocks unauthorized network traffic.",
        bestPractice: "Deploy in Audit mode for 1-2 weeks. Review firewall audit logs for legitimate traffic that would be blocked. Add allow rules, then switch to Enforce.",
        severity: "high",
      },
      {
        title: "Group-Based Source Restrictions",
        content: "Instead of specifying IP addresses, you can allow traffic from all endpoints in a specific group. The agent automatically resolves current IPs.",
        bestPractice: "Use group-based rules for dynamic environments. IP-based rules are fine for static infrastructure (servers, printers).",
        severity: "medium",
      },
      {
        title: "RDP Access",
        content: "Remote Desktop Protocol (port 3389). Highly targeted by attackers for lateral movement and initial access.",
        bestPractice: "Block from all sources except IT admin groups. Require NLA (in Group Policy). Consider disabling RDP entirely where not needed.",
        recommendedValue: "Restricted to IT groups only",
        severity: "critical",
      },
      {
        title: "SMB Access (Port 445)",
        content: "Server Message Block — used for file sharing. Notorious attack vector (WannaCry, EternalBlue).",
        bestPractice: "Block SMB between workstations. Only allow workstation → file server. Never expose SMB to the internet.",
        recommendedValue: "Restricted to file server groups",
        severity: "critical",
      },
    ],
  },
  {
    id: "hardening",
    title: "Legacy OS Hardening",
    icon: ShieldAlert,
    description: "Security hardening for end-of-life Windows systems (Win 10, Server 2012 R2)",
    articles: [
      {
        title: "Why Legacy Hardening?",
        content: "Microsoft charges for Extended Security Updates (ESU) after an OS reaches end-of-life. Legacy Hardening applies security configurations that mitigate common attack vectors without ESU, saving significant annual costs per endpoint.",
        bestPractice: "Apply hardening profiles to all legacy OS endpoints immediately. Plan migration to supported OS versions within 12-18 months.",
        severity: "critical",
      },
      {
        title: "Hardening Profiles",
        content: "Pre-built security templates that enforce registry settings, disable legacy protocols, and restrict attack surfaces. 'Maximum Hardening' applies all available mitigations. 'Balanced' applies critical mitigations while preserving broader compatibility.",
        bestPractice: "Start with 'Balanced' profile. Test for 1-2 weeks. If no compatibility issues, upgrade to 'Maximum Hardening'.",
        severity: "high",
      },
      {
        title: "Compliance Score",
        content: "Percentage of hardening checks that pass on each endpoint. 100% means all security configurations in the assigned profile are correctly applied.",
        bestPractice: "Target 95%+ compliance. Investigate any endpoint below 80% — failed checks indicate security gaps.",
        recommendedValue: "95%+",
        severity: "high",
      },
    ],
  },
  {
    id: "threat-hunting",
    title: "Threat Hunting & IOCs",
    icon: Crosshair,
    description: "Proactive threat hunting with Indicators of Compromise",
    articles: [
      {
        title: "IOC Library",
        content: "A centralized repository of known-bad indicators: file hashes, IP addresses, domains, and URLs. Import from threat feeds or add manually from incident investigations.",
        bestPractice: "Maintain an active IOC library from multiple sources (MISP, OTX, vendor advisories). Set severity levels accurately to prioritize hunt results.",
        severity: "high",
      },
      {
        title: "Hunt Jobs",
        content: "Automated sweeps across all endpoints searching for matches against your IOC library. Results show which endpoints have been exposed to known threats.",
        bestPractice: "Run hunt jobs after adding new IOCs from threat intelligence. Schedule weekly sweeps for ongoing monitoring.",
        severity: "high",
      },
      {
        title: "VirusTotal Enrichment",
        content: "Automatically queries VirusTotal for additional context on file hashes in your IOC library. Shows detection ratios from 70+ antivirus engines.",
        bestPractice: "Enable for all hash-based IOCs. A high detection ratio confirms maliciousness. A low ratio may indicate a targeted or novel threat.",
        severity: "medium",
      },
    ],
  },
  {
    id: "alerts-monitoring",
    title: "Alerts & Monitoring",
    icon: Bell,
    description: "Platform alerts, notifications, and monitoring settings",
    articles: [
      {
        title: "Alert Types",
        content: "The platform generates alerts for: endpoint offline (no check-in), threat detected, policy non-compliance, signature outdated, and protection disabled events.",
        bestPractice: "Acknowledge alerts promptly. Set up processes to review critical and high severity alerts within 1 hour.",
        severity: "high",
      },
      {
        title: "Event Logs",
        content: "Windows Event Logs collected from endpoints including Security, Application, and System logs. Searchable and filterable for investigation.",
        bestPractice: "Focus on Security log events for investigations. Use Event ID filters: 4624/4625 (logon), 4688 (process creation), 7045 (service install).",
        severity: "medium",
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Sparkles,
    description: "Recommended deployment order and initial setup guide",
    articles: [
      {
        title: "Recommended Deployment Order",
        content: "1. Deploy agents to all endpoints\n2. Create Endpoint Groups by role/department\n3. Configure and assign Defender Policies (immediate protection)\n4. Set up Group Policy (password, audit, security)\n5. Configure UAC Policies\n6. Set up Windows Update Policies\n7. Deploy Network Firewall rules (audit first)\n8. Begin WDAC application whitelisting (audit first)\n9. Enable Threat Hunting with IOC library\n10. Generate baseline Reports",
        bestPractice: "Follow this order — each step builds on the previous. Don't skip to WDAC before Defender is properly configured. Allow 1-2 weeks between major phases.",
        severity: "critical",
      },
      {
        title: "Agent Deployment",
        content: "Download the agent installer from Deploy Agent page. The agent requires an enrollment code and runs as a Windows service. It checks in every 30 seconds.",
        bestPractice: "Deploy via Group Policy, SCCM, or Intune for mass deployment. Test on a single machine first. Ensure port 443 outbound is allowed.",
        severity: "high",
      },
      {
        title: "Endpoint Groups Strategy",
        content: "Groups determine which policies apply to which endpoints. An endpoint can belong to multiple groups, but policy priority follows the earliest-assigned group.",
        bestPractice: "Create groups by function: 'Workstations', 'Servers', 'IT Admin', 'Finance', 'Developers'. This allows targeted policies per role.",
        severity: "high",
      },
    ],
  },
];

const severityColors: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-warning/10 text-warning border-warning/20",
  medium: "bg-primary/10 text-primary border-primary/20",
  low: "bg-muted text-muted-foreground border-border",
};

export default function Help() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("getting-started");

  const filteredSections = helpSections.map((section) => ({
    ...section,
    articles: section.articles.filter(
      (article) =>
        !searchQuery ||
        article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.bestPractice?.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((section) => section.articles.length > 0);

  const totalArticles = helpSections.reduce((acc, s) => acc + s.articles.length, 0);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-primary" />
            Help & Best Practices
          </h1>
          <p className="text-muted-foreground mt-1">
            {totalArticles} articles covering every platform setting with security best practices
          </p>
        </div>

        {/* Search */}
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search settings, policies, and best practices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {searchQuery ? (
          /* Search Results */
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {filteredSections.reduce((acc, s) => acc + s.articles.length, 0)} results for "{searchQuery}"
            </p>
            {filteredSections.map((section) => (
              <Card key={section.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <section.icon className="h-5 w-5 text-primary" />
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" className="space-y-1">
                    {section.articles.map((article, i) => (
                      <ArticleItem key={i} article={article} id={`${section.id}-search-${i}`} />
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          /* Category Browser */
          <div className="flex gap-6 min-h-[600px]">
            {/* Sidebar nav */}
            <Card className="w-72 shrink-0">
              <CardContent className="p-2">
                <ScrollArea className="h-[600px]">
                  <nav className="space-y-1">
                    {helpSections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all text-left",
                          activeSection === section.id
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <section.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{section.title}</span>
                        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">
                          {section.articles.length}
                        </Badge>
                      </button>
                    ))}
                  </nav>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Content area */}
            <div className="flex-1 min-w-0">
              {helpSections
                .filter((s) => s.id === activeSection)
                .map((section) => (
                  <Card key={section.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <section.icon className="h-5 w-5 text-primary" />
                        </div>
                        {section.title}
                      </CardTitle>
                      <CardDescription>{section.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="multiple" className="space-y-1">
                        {section.articles.map((article, i) => (
                          <ArticleItem key={i} article={article} id={`${section.id}-${i}`} />
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

function ArticleItem({ article, id }: { article: HelpArticle; id: string }) {
  return (
    <AccordionItem value={id} className="border border-border rounded-lg px-4 mb-2">
      <AccordionTrigger className="hover:no-underline py-3">
        <div className="flex items-center gap-3 text-left">
          {article.severity && (
            <Badge
              variant="outline"
              className={cn("text-[10px] uppercase shrink-0", severityColors[article.severity])}
            >
              {article.severity}
            </Badge>
          )}
          <span className="font-medium text-sm">{article.title}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4 space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
          {article.content}
        </p>

        {article.bestPractice && (
          <div className="flex gap-3 rounded-lg bg-success/5 border border-success/20 p-3">
            <Lightbulb className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-success mb-1">Best Practice</p>
              <p className="text-sm text-muted-foreground">{article.bestPractice}</p>
            </div>
          </div>
        )}

        {article.recommendedValue && (
          <div className="flex gap-3 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-primary mb-1">Recommended Setting</p>
              <p className="text-sm text-foreground font-mono">{article.recommendedValue}</p>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
