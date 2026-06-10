import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlatformSetting, useUpdatePlatformSetting } from "@/hooks/usePlatformSettings";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Key, Sparkles, Check, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { VirusTotalSettingsCard } from "./VirusTotalSettingsCard";
import { M365IntegrationSettingsCard } from "./M365IntegrationSettingsCard";

interface OpenAIModel {
  id: string;
  created: number;
}

export const PlatformSettingsSection = () => {
  const { data: openaiSetting, isLoading } = usePlatformSetting("openai_api_key");
  const { data: modelSetting, isLoading: modelLoading } = usePlatformSetting("openai_model");
  const updateSetting = useUpdatePlatformSetting();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasKeyChanges, setHasKeyChanges] = useState(false);
  const [availableModels, setAvailableModels] = useState<OpenAIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [isCheckingModels, setIsCheckingModels] = useState(false);
  const [hasModelChanges, setHasModelChanges] = useState(false);

  useEffect(() => {
    if (openaiSetting?.value) {
      setApiKey(openaiSetting.value);
    }
  }, [openaiSetting]);

  useEffect(() => {
    if (modelSetting?.value) {
      setSelectedModel(modelSetting.value);
    }
  }, [modelSetting]);

  const handleSaveKey = async () => {
    try {
      await updateSetting.mutateAsync({ key: "openai_api_key", value: apiKey });
      setHasKeyChanges(false);
      setAvailableModels([]); // Clear models when key changes
      toast({
        title: "API key saved",
        description: "OpenAI API key has been updated. Click 'Check Models' to verify.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to save",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSaveModel = async () => {
    try {
      await updateSetting.mutateAsync({ key: "openai_model", value: selectedModel });
      setHasModelChanges(false);
      toast({
        title: "Model saved",
        description: `AI Security Advisor will now use ${selectedModel}.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to save model",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setHasKeyChanges(value !== (openaiSetting?.value || ""));
  };

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    setHasModelChanges(value !== (modelSetting?.value || ""));
  };

  const checkModels = async () => {
    if (!apiKey) {
      toast({
        title: "No API key",
        description: "Please enter an API key first.",
        variant: "destructive",
      });
      return;
    }

    setIsCheckingModels(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-openai-models", {
        body: { apiKey },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setAvailableModels(data.models);
      
      // Auto-select the first model if none selected
      if (data.models.length > 0 && !selectedModel) {
        const defaultModel = data.models.find((m: OpenAIModel) => m.id === "gpt-4o") || data.models[0];
        setSelectedModel(defaultModel.id);
        setHasModelChanges(true);
      }

      toast({
        title: "Models loaded",
        description: `Found ${data.models.length} available models.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to check models",
        description: error.message || "Please verify your API key.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingModels(false);
    }
  };

  const isConfigured = !!openaiSetting?.value && openaiSetting.value.length > 0;

  if (isLoading || modelLoading) {
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <CardTitle className="text-lg">AI Security Advisor</CardTitle>
            <CardDescription>
              Configure OpenAI API key for AI-powered security recommendations
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
          <Label htmlFor="openai-key">OpenAI API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="openai-key"
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
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
              onClick={handleSaveKey}
              disabled={!hasKeyChanges || updateSetting.isPending}
            >
              {updateSetting.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your API key from{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              platform.openai.com/api-keys
            </a>
          </p>
        </div>

        {/* Check Models Button */}
        {isConfigured && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={checkModels}
                disabled={isCheckingModels || !apiKey}
              >
                {isCheckingModels ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Check Models
              </Button>
              {availableModels.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {availableModels.length} models available
                </span>
              )}
            </div>

            {/* Model Selection */}
            {availableModels.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="model-select">Select Model</Label>
                <div className="flex gap-2">
                  <Select value={selectedModel} onValueChange={handleModelChange}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleSaveModel}
                    disabled={!hasModelChanges || updateSetting.isPending}
                  >
                    {updateSetting.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save Model
                  </Button>
                </div>
              </div>
            )}

            {/* Current Model Display */}
            {modelSetting?.value && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground">
                  <strong>Current model:</strong> {modelSetting.value}
                </p>
                <p className="text-muted-foreground mt-1">
                  The AI Security Advisor will analyze your endpoint security posture and provide 
                  prioritized recommendations to improve protection across your fleet.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
