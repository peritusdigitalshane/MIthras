import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
    Download, Copy, CheckCircle, AlertCircle, ShieldCheck, Loader2, Package,
    KeyRound, Sparkles, Terminal, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// Stable URL — the api.mithras.com.au Caddy route serves any file dropped
// into /opt/peritus-agent-releases/ on docker02. The "latest" symlink is
// updated by installer/build.ps1 on every rebuild, so this URL always
// points at the current version.
const INSTALLER_LATEST_URL = "https://api.mithras.com.au/agent/MithrasAgent-Setup-latest.exe";

interface InstallerTabProps {
    organizationId: string;
}

interface MintedToken {
    token: string;
    max_uses: number;
    expires_at?: string | null;
}

export default function InstallerTab({ organizationId }: InstallerTabProps) {
    const { toast } = useToast();
    const [minted, setMinted] = useState<MintedToken | null>(null);
    const [isMinting, setIsMinting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [codeCopied, setCodeCopied] = useState(false);
    const [silentCopied, setSilentCopied] = useState(false);

    useEffect(() => {
        setMinted(null);
        setError(null);
    }, [organizationId]);

    const mint = async () => {
        if (!organizationId) {
            setError("No organisation selected.");
            return;
        }
        setIsMinting(true);
        setError(null);
        try {
            // The agent-enroll edge function validates against the
            // enrollment_tokens table (not enrollment_codes — those are
            // org-signup human codes). Use the same SECURITY DEFINER RPC
            // the Service tab does so the .exe installer's /CODE flag
            // produces a token that agent-enroll will accept.
            const { data, error: rpcErr } = await supabase.rpc("create_enrollment_token", {
                p_org_id: organizationId,
                p_runtime_hint: "powershell",
                p_channel: "stable",
                p_hostname_hint: null,
                p_max_uses: 1,
            });
            if (rpcErr) throw new Error(rpcErr.message ?? "create_enrollment_token failed");
            const row = Array.isArray(data) ? data[0] : (data as { token?: string; max_uses?: number; expires_at?: string } | null);
            if (!row?.token) throw new Error("RPC returned no token");
            setMinted({ token: row.token, max_uses: row.max_uses ?? 1, expires_at: row.expires_at ?? null });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to generate token");
        } finally {
            setIsMinting(false);
        }
    };

    const silentCommand = useMemo(() =>
        minted
            ? `MithrasAgent-Setup-latest.exe /VERYSILENT /CODE=${minted.token}`
            : `MithrasAgent-Setup-latest.exe /VERYSILENT /CODE=YOUR-ENROLMENT-TOKEN`,
        [minted]
    );

    const copy = async (text: string, label: string, setter: (b: boolean) => void) => {
        try {
            await navigator.clipboard.writeText(text);
            setter(true);
            toast({ title: `${label} copied to clipboard` });
            setTimeout(() => setter(false), 2000);
        } catch {
            toast({ title: "Couldn't copy", description: "Select the text manually.", variant: "destructive" });
        }
    };

    return (
        <div className="space-y-4 mt-4">
            {/* Hero */}
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
                <CardHeader>
                    <div className="flex items-center gap-2 mb-1">
                        <Package className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">Mithras Agent Installer</CardTitle>
                        <Badge variant="outline" className="border-primary/40 text-primary text-[10px] uppercase tracking-wider">
                            <Sparkles className="h-3 w-3 mr-1" /> Recommended
                        </Badge>
                    </div>
                    <CardDescription>
                        Single-file Windows installer (.exe). Double-click, paste your enrolment
                        token, Next-Next-Finish. Friendly for SMBs and end users.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button asChild size="lg" className="gap-2">
                            <a href={INSTALLER_LATEST_URL} download>
                                <Download className="h-4 w-4" />
                                Download MithrasAgent-Setup.exe
                            </a>
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            ~2.3 MB · Windows 10/11 · requires Administrator
                        </span>
                    </div>

                    <Alert className="border-amber-500/40">
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <AlertTitle>Windows will show a yellow "Unknown publisher" warning</AlertTitle>
                        <AlertDescription className="text-xs">
                            Click <strong>More info → Run anyway</strong>. This disappears once we
                            ship a code-signed build (work in progress). The installer is safe — it's
                            just not yet cryptographically endorsed by a public CA.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>

            {/* Step 1 — Mint enrolment token */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-primary" />
                        Generate an enrolment token
                    </CardTitle>
                    <CardDescription>
                        Single-use, expires in 7 days. The installer accepts this as the
                        <em> Connect this endpoint</em> code, or pass it via <code>/CODE=xxx</code>
                        for silent deployments.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button onClick={mint} disabled={isMinting || !organizationId} className="gap-2">
                        {isMinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {minted ? "Generate a fresh token" : "Generate enrolment token"}
                    </Button>
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    {minted && (
                        <>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 font-mono text-sm bg-secondary/50 rounded-md p-3 break-all">
                                    {minted.token}
                                </code>
                                <Button
                                    variant="outline"
                                    onClick={() => copy(minted.token, "Enrolment token", setCodeCopied)}
                                    className="gap-1.5"
                                >
                                    {codeCopied ? <CheckCircle className="h-4 w-4 text-status-healthy" /> : <Copy className="h-4 w-4" />}
                                    {codeCopied ? "Copied" : "Copy"}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Token expires: {minted.expires_at ? new Date(minted.expires_at).toLocaleString() : "in 7 days"} ·
                                {" "}{minted.max_uses} use{minted.max_uses === 1 ? "" : "s"} remaining.
                            </p>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Silent install for MSPs — only show after token minted */}
            {minted && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-primary" />
                            Silent install (MSPs / RMM tools)
                        </CardTitle>
                        <CardDescription>
                            Deploy across a fleet with no UI prompts. Embeds the enrolment token
                            as a command-line flag.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="relative">
                            <pre className="rounded-lg bg-secondary/50 p-3 text-xs overflow-x-auto pr-12">
                                <code>{silentCommand}</code>
                            </pre>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="absolute top-1.5 right-1.5 gap-1"
                                onClick={() => copy(silentCommand, "Silent install command", setSilentCopied)}
                            >
                                {silentCopied ? <CheckCircle className="h-3.5 w-3.5 text-status-healthy" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
                            <li><code>/VERYSILENT</code> = no UI; <code>/SILENT</code> = progress bar only.</li>
                            <li><code>/CODE=xxx</code> = pre-fills the enrolment field and skips the prompt page.</li>
                            <li>Exit code 0 on success — wrap in your RMM workflow and check it.</li>
                            <li>Compatible with Intune Win32 LOB apps, ConnectWise Automate, NinjaOne, Atera.</li>
                        </ul>
                    </CardContent>
                </Card>
            )}

            {/* What the installer does */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        What gets installed
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ul className="text-xs space-y-1 list-disc pl-5">
                        <li>Agent files → <code>C:\ProgramData\Mithras</code></li>
                        <li>Windows service <code>MithrasAgent</code> (auto-start, runs as LocalSystem)</li>
                        <li>Add/Remove Programs entry under <strong>Mithras Threat Defence</strong></li>
                        <li>First check-in within 30 seconds of install</li>
                        <li>Auto-updates over the same channel; no admin action needed for version bumps</li>
                        <li>Clean uninstall via Settings → Apps → Mithras Threat Defence → Uninstall</li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
