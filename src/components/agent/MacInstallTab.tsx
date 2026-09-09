import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
    Copy, CheckCircle, AlertCircle, Loader2, RefreshCw, Apple, Terminal,
    ShieldCheck, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MacInstallTabProps {
    organizationId: string | null;
}

interface MintedToken {
    token: string;
    max_uses: number;
    expires_at?: string | null;
}

// Caddy serves these straight from /opt/peritus-agent-releases on docker02.
// Path matches Linux pattern — single shell-installer URL per platform.
const INSTALL_URL = "https://api.mithras.com.au/agent/install-mac.sh";

export default function MacInstallTab({ organizationId }: MacInstallTabProps) {
    const { toast } = useToast();
    const [minted, setMinted] = useState<MintedToken | null>(null);
    const [isMinting, setIsMinting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setMinted(null);
        setError(null);
        setCopied(false);
    }, [organizationId]);

    const mint = async () => {
        if (!organizationId) {
            setError("No organisation selected.");
            return;
        }
        setIsMinting(true);
        setError(null);
        try {
            // Mirror the Windows ServiceInstallTab flow: mint a single-use
            // enrolment token via the SECURITY DEFINER RPC. The Mac install
            // script consumes it on first heartbeat.
            const { data, error: rpcErr } = await supabase.rpc("create_enrollment_token", {
                p_org_id: organizationId,
                p_runtime_hint: "macos",
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

    const oneLiner = minted
        ? `curl -fsSL ${INSTALL_URL} | sudo bash -s -- --token=${minted.token}`
        : "";

    const copyOneLiner = async () => {
        if (!oneLiner) return;
        await navigator.clipboard.writeText(oneLiner);
        setCopied(true);
        toast({ title: "Install command copied" });
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-4 mt-4">
            {/* Hero */}
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
                <CardHeader>
                    <div className="flex items-center gap-2 mb-1">
                        <Apple className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">macOS Agent</CardTitle>
                        <Badge variant="outline" className="border-primary/40 text-primary text-[10px] uppercase tracking-wider">
                            <Sparkles className="h-3 w-3 mr-1" /> Lightweight v1
                        </Badge>
                    </div>
                    <CardDescription>
                        Bash + launchd daemon. Heartbeats every 30s with FileVault, SIP, Gatekeeper,
                        Firewall, MDM enrolment, XProtect version + installed-apps inventory.
                        Tested on macOS 13 Ventura / 14 Sonoma / 15 Sequoia, Apple Silicon + Intel.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Alert className="border-amber-500/40">
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <AlertTitle>What's NOT in v1</AlertTitle>
                        <AlertDescription className="text-xs space-y-1">
                            <p>Real-time process monitoring, file events, and isolation/kill commands require Apple's Endpoint Security Framework — that's the Q4 native agent. v1 covers posture, identity, and inventory, which is enough to score a Mac fleet and catch misconfiguration drift.</p>
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>

            {/* Step 1 — generate token */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">1. Generate an enrolment token</CardTitle>
                    <CardDescription>
                        Single-use, expires in 7 days. Mint one per Mac you want to enrol — or set
                        a higher use count below for fleet rollouts.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button onClick={mint} disabled={isMinting || !organizationId} className="gap-2">
                        {isMinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {minted ? "Generate a fresh token" : "Generate install command"}
                    </Button>
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            {/* Step 2 — copy + paste */}
            {minted && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-primary" /> 2. Run this on the Mac
                        </CardTitle>
                        <CardDescription>
                            Open Terminal on the target Mac, paste, hit Enter, type the admin
                            password when prompted. Done.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="relative">
                            <pre className="rounded-lg bg-secondary/50 p-3 text-xs overflow-x-auto pr-12 break-all whitespace-pre-wrap">
                                <code>{oneLiner}</code>
                            </pre>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="absolute top-1.5 right-1.5 gap-1"
                                onClick={copyOneLiner}
                            >
                                {copied ? <CheckCircle className="h-3.5 w-3.5 text-status-healthy" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
                            <li>The Mac appears in your console within <strong>~60 seconds</strong> of running this.</li>
                            <li>Token expires {minted.expires_at ? new Date(minted.expires_at).toLocaleString() : "in 7 days"} · {minted.max_uses} use{minted.max_uses === 1 ? "" : "s"} remaining.</li>
                            <li>If you need multiple Macs from the same token, re-mint with a higher max_uses (we'll surface that toggle next iteration).</li>
                        </ul>
                    </CardContent>
                </Card>
            )}

            {/* Step 3 — what you get */}
            {minted && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-primary" /> What the agent collects
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div>
                                <p className="font-medium mb-1">Posture (every 60s)</p>
                                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                                    <li>FileVault encryption state</li>
                                    <li>SIP (System Integrity Protection)</li>
                                    <li>Gatekeeper assessment</li>
                                    <li>Firewall on/off</li>
                                    <li>MDM enrolment status</li>
                                    <li>XProtect signature version</li>
                                    <li>Remote login (sshd)</li>
                                    <li>Secure boot (Apple Silicon)</li>
                                </ul>
                            </div>
                            <div>
                                <p className="font-medium mb-1">Telemetry</p>
                                <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                                    <li>Hostname + OS version + build + arch</li>
                                    <li>Hardware model + UUID</li>
                                    <li>Auth events (sudo, loginwindow, sshd) — last 5 min</li>
                                    <li>Installed apps inventory — every 6 hours, from /Applications + ~/Applications + Homebrew</li>
                                </ul>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 4 — management commands */}
            {minted && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Manage the agent</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs">
                        <div>
                            <p className="font-medium mb-1">Status</p>
                            <pre className="rounded-lg bg-secondary/50 p-2 overflow-x-auto"><code>sudo launchctl print system/com.mithras.agent | head -20</code></pre>
                        </div>
                        <div>
                            <p className="font-medium mb-1">Live logs</p>
                            <pre className="rounded-lg bg-secondary/50 p-2 overflow-x-auto"><code>tail -f /usr/local/var/log/mithras/agent.log</code></pre>
                        </div>
                        <div>
                            <p className="font-medium mb-1">Uninstall</p>
                            <pre className="rounded-lg bg-secondary/50 p-2 overflow-x-auto"><code>curl -fsSL https://api.mithras.com.au/agent/uninstall-mac.sh | sudo bash</code></pre>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
