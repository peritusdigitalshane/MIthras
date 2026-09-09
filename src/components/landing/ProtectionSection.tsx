import {
  ShieldCheck, Scan, Cloud, Bug, FileSearch, HardDrive, Zap, FileWarning,
  Archive, Mail, Code, FolderLock, Network, ShieldAlert, Layers,
  FileCode, Key, Terminal, Activity, Lock
} from "lucide-react";

export function ProtectionSection() {
  return (
    <section id="protection" className="py-24 px-6 bg-muted/30">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-status-healthy/10 text-status-healthy text-sm font-medium mb-4">
            <ShieldCheck className="h-4 w-4" />
            Comprehensive Protection
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Every Layer of Defense, Managed
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Configure and enforce all Microsoft Defender protection features from a single policy.
            Real-time protection, cloud intelligence, and attack surface reduction.
          </p>
        </div>

        {/* Core Protection */}
        <div className="mb-16">
          <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Core Protection
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <ProtectionItem icon={<Scan className="h-4 w-4" />} title="Real-time Monitoring" description="Continuous protection against malware" />
            <ProtectionItem icon={<Cloud className="h-4 w-4" />} title="Cloud-Delivered Protection" description="Microsoft cloud enhanced detection" />
            <ProtectionItem icon={<Bug className="h-4 w-4" />} title="Behavior Monitoring" description="Monitor process behavior for threats" />
            <ProtectionItem icon={<FileSearch className="h-4 w-4" />} title="IOAV Protection" description="Scan files downloaded from the internet" />
            <ProtectionItem icon={<Code className="h-4 w-4" />} title="Script Scanning" description="Scan PowerShell and other scripts" />
            <ProtectionItem icon={<HardDrive className="h-4 w-4" />} title="Removable Drive Scanning" description="Scan USB drives and external media" />
            <ProtectionItem icon={<Zap className="h-4 w-4" />} title="Block at First Seen" description="Block new threats immediately" />
            <ProtectionItem icon={<FileWarning className="h-4 w-4" />} title="PUA Protection" description="Block potentially unwanted applications" />
            <ProtectionItem icon={<Archive className="h-4 w-4" />} title="Archive Scanning" description="Scan inside ZIP and other archives" />
            <ProtectionItem icon={<Mail className="h-4 w-4" />} title="Email Scanning" description="Scan email attachments" />
            <ProtectionItem icon={<ShieldCheck className="h-4 w-4" />} title="Signature Verification" description="Verify definitions before scanning" />
          </div>
        </div>

        {/* Advanced Protection */}
        <div className="mb-16">
          <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Advanced Protection
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProtectionItem icon={<FolderLock className="h-4 w-4" />} title="Controlled Folder Access" description="Protect folders from ransomware encryption" variant="highlight" />
            <ProtectionItem icon={<Network className="h-4 w-4" />} title="Network Protection" description="Block connections to malicious domains" variant="highlight" />
            <ProtectionItem icon={<ShieldAlert className="h-4 w-4" />} title="Exploit Protection" description="Apply process mitigation settings" variant="highlight" />
          </div>
        </div>

        {/* ASR Rules */}
        <div className="mb-16">
          <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Attack Surface Reduction (16 Rules)
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[
              { title: "Block Vulnerable Drivers", desc: "Prevent exploited signed drivers" },
              { title: "Block Email Executables", desc: "Block executables from email" },
              { title: "Block Office Child Processes", desc: "Prevent Office spawning processes" },
              { title: "Block Office Executables", desc: "Block Office creating executables" },
              { title: "Block Code Injection", desc: "Prevent Office code injection" },
              { title: "Block JS/VBS Executables", desc: "Block script-launched executables" },
              { title: "Block Obfuscated Scripts", desc: "Detect and block obfuscated code" },
              { title: "Block Office Macro Win32", desc: "Block VBA macro Win32 API calls" },
              { title: "Block Untrusted Executables", desc: "Block unknown executables" },
              { title: "Ransomware Protection", desc: "Advanced ransomware defense" },
              { title: "Block Credential Stealing", desc: "Protect LSASS from attacks" },
              { title: "Block PSExec & WMI", desc: "Block remote execution tools" },
              { title: "Block USB Untrusted", desc: "Block untrusted USB executables" },
              { title: "Block Outlook Child Processes", desc: "Prevent Outlook spawning processes" },
              { title: "Block Adobe Child Processes", desc: "Prevent Adobe Reader spawning" },
              { title: "Block WMI Persistence", desc: "Block WMI event persistence" },
            ].map(rule => (
              <div key={rule.title} className="p-3 rounded-lg border border-status-warning/30 bg-status-warning/5 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 text-status-warning flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h4 className="font-medium text-sm">{rule.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{rule.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* WDAC */}
        <div>
          <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Application Whitelisting (WDAC)
          </h3>
          <p className="text-muted-foreground mb-6 max-w-3xl">
            Windows Defender Application Control provides zero-trust application security. Only explicitly allowed
            applications can run, blocking malware, ransomware, and unauthorized software before execution.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <ProtectionItem icon={<FileCode className="h-4 w-4" />} title="Publisher Rules" description="Allow apps signed by trusted publishers" variant="highlight" />
            <ProtectionItem icon={<FolderLock className="h-4 w-4" />} title="Path Rules" description="Allow apps from trusted locations" variant="highlight" />
            <ProtectionItem icon={<Key className="h-4 w-4" />} title="Hash Rules" description="Allow specific file hashes" variant="highlight" />
            <ProtectionItem icon={<Layers className="h-4 w-4" />} title="Rule Sets" description="Reusable rule collections" variant="highlight" />
            <ProtectionItem icon={<FileSearch className="h-4 w-4" />} title="App Discovery" description="Auto-discover running applications" variant="highlight" />
            <ProtectionItem icon={<ShieldCheck className="h-4 w-4" />} title="Audit Mode" description="Test policies before enforcement" variant="highlight" />
            <ProtectionItem icon={<Terminal className="h-4 w-4" />} title="Block Mode" description="Enforce strict application control" variant="highlight" />
            <ProtectionItem icon={<Activity className="h-4 w-4" />} title="Baseline Snapshots" description="Track policy drift over time" variant="highlight" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProtectionItem({ icon, title, description, variant = "default" }: {
  icon: React.ReactNode; title: string; description: string; variant?: "default" | "highlight";
}) {
  return (
    <div className={`p-4 rounded-lg border ${
      variant === "highlight" ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card"
    } flex items-start gap-3`}>
      <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${
        variant === "highlight" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
      }`}>
        {icon}
      </div>
      <div className="min-w-0">
        <h4 className="font-medium text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
