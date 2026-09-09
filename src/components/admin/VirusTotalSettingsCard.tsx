import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlatformSetting, useUpdatePlatformSetting } from "@/hooks/usePlatformSettings";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Key, Shield, Check, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const VirusTotalSettingsCard = () => {
  const { data: vtSetting, isLoading } = usePlatformSetting("virustotal_api_key");
  const updateSetting = useUpdatePlatformSetting();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (vtSetting?.value) {
      setApiKey(vtSetting.value);
    }
  }, [vtSetting]);

  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({ key: "virustotal_api_key", value: apiKey });
      setHasChanges(false);
      toast({
        title: "API key saved",
        description: "VirusTotal API key has been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to save",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setHasChanges(value !== (vtSetting?.value || ""));
  };

  const testConnection = async () => {
    if (!apiKey) {
      toast({
        title: "No API key",
        description: "Please enter an API key first.",
        variant: "destructive",
      });
      return;
    }

    // Save first if there are changes
    if (hasChanges) {
      await handleSave();
    }

    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("virustotal-lookup", {
        body: { action: "test" },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.success) {
        toast({
          title: "Connection successful",
          description: data.message || "VirusTotal API is working correctly.",
        });
      } else {
        throw new Error(data.error || "Connection test failed");
      }
    } catch (error: any) {
      toast({
        title: "Connection failed",
        description: error.message || "Please verify your API key.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const isConfigured = !!vtSetting?.value && vtSetting.value.length > 0;

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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <Shield className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <CardTitle className="text-lg">VirusTotal Integration</CardTitle>
            <CardDescription>
              Enrich IOCs with threat intelligence from VirusTotal
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          <Key className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Status:</span>
          {isConfigured ? (
            <span className="flex items-center gap-1 text-green-600">
              <Check className="h-4 w-4" />
              Configured
            </span>
          ) : (
            <span className="text-amber-600">Not configured</span>
          )}
        </div>

        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="vt-key">VirusTotal API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="vt-key"
                type={showKey ? "text" : "password"}
                placeholder="Enter your VirusTotal API key"
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                className="pr-10 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateSetting.isPending}
            >
              {updateSetting.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your free API key from{" "}
            <a
              href="https://www.virustotal.com/gui/join-us"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              virustotal.com
            </a>
          </p>
        </div>

        {/* Test Connection */}
        {isConfigured && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={isTesting}
            >
              {isTesting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              Test Connection
            </Button>
          </div>
        )}

        {/* Info */}
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="text-muted-foreground">
            <strong>Usage:</strong> Once configured, you can look up file hashes in the IOC Library 
            to get threat intelligence including detection ratios, threat names, and file metadata.
          </p>
          <p className="text-muted-foreground mt-2">
            <strong>Rate limits:</strong> Free tier allows 4 requests/minute and 500 requests/day.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
