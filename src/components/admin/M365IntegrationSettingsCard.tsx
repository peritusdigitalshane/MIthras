import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Cloud, Loader2, Save, BookOpen, CheckCircle2 } from "lucide-react";

interface M365Settings {
    m365_azure_client_id: string;
    m365_azure_client_secret: string;
    m365_azure_redirect_uri: string;
    m365_azure_authority: string;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const resp = await fetch(`${supabaseUrl}/functions/v1/m365-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, ...payload }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
    return json;
}

export function M365IntegrationSettingsCard() {
    const { toast } = useToast();
    const { isSuperAdmin } = useTenant();
    // Defence in depth: the edge function enforces super-admin server-side,
    // but the card writes platform-wide Azure credentials so it must not
    // render for any non-super-admin even if Settings.tsx is misconfigured.
    if (!isSuperAdmin) return null;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasStoredSecret, setHasStoredSecret] = useState(false);
    const [s, setS] = useState<M365Settings>({
        m365_azure_client_id: "",
        m365_azure_client_secret: "",
        m365_azure_redirect_uri: "",
        m365_azure_authority: "https://login.microsoftonline.com",
    });

    useEffect(() => {
        (async () => {
            try {
                const r = await call("get");
                const out = (r.settings ?? {}) as Partial<M365Settings> & { m365_azure_client_secret?: string };
                setS(prev => ({ ...prev, ...out, m365_azure_client_secret: "" }));
                setHasStoredSecret(out.m365_azure_client_secret === "__redacted__");
            } catch (e) {
                toast({
                    title: "Couldn't load M365 settings",
                    description: e instanceof Error ? e.message : "Unknown",
                    variant: "destructive",
                });
            } finally {
                setLoading(false);
            }
        })();
    }, [toast]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await call("save", { settings: s });
            toast({
                title: "M365 integration saved",
                description: "Customers can now connect their Microsoft 365 tenant from the Identity page.",
            });
            if (s.m365_azure_client_secret) setHasStoredSecret(true);
        } catch (e) {
            toast({
                title: "Save failed",
                description: e instanceof Error ? e.message : "Unknown",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }

    const isConfigured = !!s.m365_azure_client_id && (hasStoredSecret || !!s.m365_azure_client_secret) && !!s.m365_azure_redirect_uri;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Cloud className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Microsoft 365 / Entra ID integration</CardTitle>
                </div>
                <CardDescription>
                    Lets customers connect their Microsoft 365 tenant for identity threat detection
                    (suspicious sign-ins, malicious mailbox rules, MFA changes, privileged role
                    grants, illicit OAuth consents). Requires a multi-tenant Azure AD app
                    registration in your own Azure tenant.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <Alert>
                    <BookOpen className="h-4 w-4" />
                    <AlertTitle className="text-sm">First-time setup</AlertTitle>
                    <AlertDescription className="text-xs space-y-1 mt-1">
                        Follow the step-by-step guide before filling in the fields below — it
                        walks through registering the Azure AD app, picking the right Graph API
                        permissions (read-only by default, opt-in remediation), and creating the
                        client secret.
                        <div className="mt-2">
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/guides/m365-itdr-setup">
                                    <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                                    Open the setup guide
                                </Link>
                            </Button>
                        </div>
                    </AlertDescription>
                </Alert>

                <div className="space-y-1.5">
                    <Label htmlFor="m365_client_id">Application (client) ID</Label>
                    <Input
                        id="m365_client_id"
                        value={s.m365_azure_client_id}
                        onChange={(e) => setS(p => ({ ...p, m365_azure_client_id: e.target.value }))}
                        placeholder="e.g. 11111111-2222-3333-4444-555555555555"
                        autoComplete="off"
                    />
                    <p className="text-[11px] text-muted-foreground">
                        From Azure portal → App registrations → Mithras ITDR → Overview.
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="m365_client_secret">Client secret value</Label>
                    <Input
                        id="m365_client_secret"
                        type="password"
                        value={s.m365_azure_client_secret}
                        onChange={(e) => setS(p => ({ ...p, m365_azure_client_secret: e.target.value }))}
                        placeholder={hasStoredSecret ? "•••••••••• (saved — leave blank to keep)" : "Paste the secret value, not the secret ID"}
                        autoComplete="new-password"
                    />
                    {hasStoredSecret && !s.m365_azure_client_secret && (
                        <p className="text-[11px] text-muted-foreground">
                            A secret is already saved. Type a new one to replace it, or leave blank to keep.
                        </p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="m365_redirect_uri">Redirect URI</Label>
                    <Input
                        id="m365_redirect_uri"
                        value={s.m365_azure_redirect_uri}
                        onChange={(e) => setS(p => ({ ...p, m365_azure_redirect_uri: e.target.value }))}
                        placeholder="https://api.mithras.com.au/functions/v1/m365-oauth-callback"
                        autoComplete="off"
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Must match the redirect URI you registered on the Azure AD app
                        exactly — Microsoft is strict about trailing slashes, http vs https,
                        etc.
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="m365_authority">Authority</Label>
                    <Input
                        id="m365_authority"
                        value={s.m365_azure_authority}
                        onChange={(e) => setS(p => ({ ...p, m365_azure_authority: e.target.value }))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Almost always the default. Change only if you're targeting a sovereign
                        cloud (US Government, China, Germany).
                    </p>
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-2 text-xs">
                        {isConfigured ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium">
                                <CheckCircle2 className="h-4 w-4" />
                                Configured — customers can connect from /m365
                            </span>
                        ) : (
                            <span className="text-muted-foreground">
                                Fill in all fields and save to enable the M365 connect flow.
                            </span>
                        )}
                    </div>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        Save
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
