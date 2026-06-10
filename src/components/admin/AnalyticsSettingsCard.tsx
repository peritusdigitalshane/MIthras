import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { usePlatformSetting, useUpdatePlatformSetting } from "@/hooks/usePlatformSettings";
import { useToast } from "@/hooks/use-toast";

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i;

export function AnalyticsSettingsCard() {
    const { data: gtmRow,     isLoading: l1 } = usePlatformSetting("analytics_gtm_id");
    const { data: loggedInRow, isLoading: l2 } = usePlatformSetting("analytics_track_logged_in");
    const { data: consentRow,  isLoading: l3 } = usePlatformSetting("analytics_consent_mode");
    const updateSetting = useUpdatePlatformSetting();
    const { toast } = useToast();

    const isLoading = l1 || l2 || l3;

    const [gtmId, setGtmId] = useState("");
    const [trackLoggedIn, setTrackLoggedIn] = useState(false);
    const [consentMode, setConsentMode] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        setGtmId(gtmRow?.value ?? "");
    }, [gtmRow?.value]);
    useEffect(() => {
        setTrackLoggedIn((loggedInRow?.value ?? "false") === "true");
    }, [loggedInRow?.value]);
    useEffect(() => {
        setConsentMode((consentRow?.value ?? "false") === "true");
    }, [consentRow?.value]);

    const isValidGtm = gtmId === "" || GTM_ID_PATTERN.test(gtmId);

    const handleSave = async () => {
        if (!isValidGtm) {
            toast({
                title: "Invalid container ID",
                description: "GTM container IDs look like GTM-XXXXXXX. Leave blank to disable tracking.",
                variant: "destructive",
            });
            return;
        }
        try {
            await Promise.all([
                updateSetting.mutateAsync({ key: "analytics_gtm_id",          value: gtmId.trim() }),
                updateSetting.mutateAsync({ key: "analytics_track_logged_in", value: trackLoggedIn ? "true" : "false" }),
                updateSetting.mutateAsync({ key: "analytics_consent_mode",    value: consentMode ? "true" : "false" }),
            ]);
            setDirty(false);
            toast({
                title: "Analytics settings saved",
                description: gtmId
                    ? "Visitors will start firing pageviews on their next public-route navigation."
                    : "Tracking disabled. Existing visitors will stop firing pageviews on next page load.",
            });
        } catch (err: any) {
            toast({
                title: "Failed to save",
                description: err?.message ?? "Please try again.",
                variant: "destructive",
            });
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                        <BarChart3 className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                        <CardTitle className="text-lg">Analytics</CardTitle>
                        <CardDescription>
                            Google Tag Manager on the public marketing surfaces — landing, blog, /personal, /contact-sales, legal.
                            Operator console and customer portals are never tracked.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Status badge */}
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Status:</span>
                    {gtmRow?.value ? (
                        <span className="flex items-center gap-1 text-green-600">
                            <Check className="h-4 w-4" /> Configured ({gtmRow.value})
                        </span>
                    ) : (
                        <span className="text-amber-600">Not configured — no tracking on the website</span>
                    )}
                </div>

                {/* GTM ID */}
                <div className="space-y-2">
                    <Label htmlFor="gtm-id">Google Tag Manager container ID</Label>
                    <div className="flex gap-2">
                        <Input
                            id="gtm-id"
                            placeholder="GTM-XXXXXXX"
                            value={gtmId}
                            onChange={(e) => { setGtmId(e.target.value); setDirty(true); }}
                            className={`font-mono ${!isValidGtm ? "border-destructive" : ""}`}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Create a container in{" "}
                        <a href="https://tagmanager.google.com/" target="_blank" rel="noopener" className="text-primary hover:underline">
                            Google Tag Manager
                        </a>
                        , put your GA4 measurement ID inside the container as a tag, and paste the GTM-XXXXXXX ID here.
                        Leave blank to disable all tracking.
                    </p>
                </div>

                {/* Track signed-in visitors toggle */}
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="track-logged-in" className="text-sm">Track signed-in visitors</Label>
                        <p className="text-xs text-muted-foreground max-w-md">
                            By default, pageviews from logged-in users on public pages are skipped to keep org names and
                            customer activity out of GA. Turn on only if you specifically want to track engagement of
                            existing customers with blog / pricing pages.
                        </p>
                    </div>
                    <Switch
                        id="track-logged-in"
                        checked={trackLoggedIn}
                        onCheckedChange={(v) => { setTrackLoggedIn(v); setDirty(true); }}
                    />
                </div>

                {/* Consent Mode v2 toggle */}
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="consent-mode" className="text-sm">Consent Mode v2 (default = denied)</Label>
                        <p className="text-xs text-muted-foreground max-w-md">
                            Pushes the v2 consent defaults (ad / analytics / personalisation = denied) on load. Required for
                            EU traffic without a cookie banner. AU traffic doesn't strictly need it. Leave off if your GTM
                            container already handles consent.
                        </p>
                    </div>
                    <Switch
                        id="consent-mode"
                        checked={consentMode}
                        onCheckedChange={(v) => { setConsentMode(v); setDirty(true); }}
                    />
                </div>

                <div className="flex justify-end">
                    <Button
                        onClick={handleSave}
                        disabled={!dirty || !isValidGtm || updateSetting.isPending}
                    >
                        {updateSetting.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </div>

                {/* Info */}
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
                    <p>
                        <strong>Cached for 60s:</strong> changes propagate to a visitor on their next page load (~60s if
                        their browser cached the previous config; immediate on a hard refresh).
                    </p>
                    <p>
                        <strong>Tracked surfaces:</strong> <code>/</code>, <code>/login</code>, <code>/signup</code>,{" "}
                        <code>/channel-program</code>, <code>/contact-sales</code>, <code>/personal</code>,{" "}
                        <code>/blog/*</code>, <code>/guides/*</code>, <code>/privacy</code>, <code>/terms</code>,{" "}
                        <code>/security</code>, <code>/acceptable-use</code>, <code>/status</code>.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
