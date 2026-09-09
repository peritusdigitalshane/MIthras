import { useState } from "react";
import { X, Save, Shield, Zap, Lock, AlertTriangle, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AsrRuleToggle } from "./AsrRuleToggle";
import { ExclusionsEditor } from "./ExclusionsEditor";
import {
  DefenderPolicy,
  AsrAction,
  ASR_RULES,
  BASIC_PROTECTION_SETTINGS,
  ADVANCED_SETTINGS,
  CLOUD_BLOCK_LEVELS,
  MAPS_REPORTING_OPTIONS,
  SAMPLE_SUBMISSION_OPTIONS,
} from "@/lib/defender-settings";

interface PolicyEditorProps {
  policy?: DefenderPolicy;
  onSave: (policy: Partial<DefenderPolicy>) => void;
  onClose: () => void;
}

const defaultPolicy: Partial<DefenderPolicy> = {
  name: "",
  description: "",
  is_default: false,
  realtime_monitoring: true,
  cloud_delivered_protection: true,
  maps_reporting: "Advanced",
  sample_submission: "SendAllSamples",
  check_signatures_before_scan: true,
  behavior_monitoring: true,
  ioav_protection: true,
  script_scanning: true,
  removable_drive_scanning: true,
  block_at_first_seen: true,
  pua_protection: true,
  signature_update_interval: 8,
  archive_scanning: true,
  email_scanning: true,
  cloud_block_level: "High",
  cloud_extended_timeout: 50,
  controlled_folder_access: true,
  network_protection: true,
  asr_block_vulnerable_drivers: "enabled",
  asr_block_email_executable: "enabled",
  asr_block_office_child_process: "enabled",
  asr_block_office_executable_content: "enabled",
  asr_block_office_code_injection: "enabled",
  asr_block_js_vbs_executable: "enabled",
  asr_block_obfuscated_scripts: "enabled",
  asr_block_office_macro_win32: "enabled",
  asr_block_untrusted_executables: "enabled",
  asr_advanced_ransomware_protection: "enabled",
  asr_block_credential_stealing: "audit",
  asr_block_psexec_wmi: "enabled",
  asr_block_usb_untrusted: "enabled",
  asr_block_office_comms_child_process: "audit",
  asr_block_adobe_child_process: "audit",
  asr_block_wmi_persistence: "enabled",
  exploit_protection_enabled: true,
  exclusion_paths: [],
  exclusion_processes: [],
  exclusion_extensions: [],
};

export function PolicyEditor({ policy, onSave, onClose }: PolicyEditorProps) {
  const [formData, setFormData] = useState<Partial<DefenderPolicy>>(
    policy || defaultPolicy
  );

  const updateField = <K extends keyof DefenderPolicy>(
    field: K,
    value: DefenderPolicy[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-background border-l border-border shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">
                  {policy ? "Edit Policy" : "Create Policy"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Configure Defender settings for endpoints
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Policy Name</Label>
                  <Input
                    id="name"
                    value={formData.name || ""}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder="e.g., Standard Workstation Policy"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description || ""}
                    onChange={(e) => updateField("description", e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* Tabbed Settings */}
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="basic" className="text-xs">
                    <Shield className="h-3.5 w-3.5 mr-1.5" />
                    Basic
                  </TabsTrigger>
                  <TabsTrigger value="cloud" className="text-xs">
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                    Cloud
                  </TabsTrigger>
                  <TabsTrigger value="advanced" className="text-xs">
                    <Lock className="h-3.5 w-3.5 mr-1.5" />
                    Advanced
                  </TabsTrigger>
                  <TabsTrigger value="asr" className="text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                    ASR
                  </TabsTrigger>
                  <TabsTrigger value="exclusions" className="text-xs">
                    <FolderX className="h-3.5 w-3.5 mr-1.5" />
                    Exclusions
                  </TabsTrigger>
                </TabsList>

                {/* Basic Protection */}
                <TabsContent value="basic" className="mt-4 space-y-3">
                  {BASIC_PROTECTION_SETTINGS.map((setting) => (
                    <div
                      key={setting.id}
                      className="flex items-center justify-between py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{setting.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {setting.description}
                        </p>
                      </div>
                      <Switch
                        checked={formData[setting.id as keyof DefenderPolicy] as boolean}
                        onCheckedChange={(checked) =>
                          updateField(setting.id as keyof DefenderPolicy, checked as never)
                        }
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">Signature Update Interval</p>
                      <p className="text-xs text-muted-foreground">
                        Hours between signature updates
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      className="w-20"
                      value={formData.signature_update_interval || 8}
                      onChange={(e) =>
                        updateField("signature_update_interval", parseInt(e.target.value))
                      }
                    />
                  </div>
                </TabsContent>

                {/* Cloud Settings */}
                <TabsContent value="cloud" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Cloud Block Level</Label>
                    <Select
                      value={formData.cloud_block_level}
                      onValueChange={(value) => updateField("cloud_block_level", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLOUD_BLOCK_LEVELS.map((level) => (
                          <SelectItem key={level.value} value={level.value}>
                            <div>
                              <span className="font-medium">{level.label}</span>
                              <span className="text-muted-foreground ml-2">
                                - {level.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>MAPS Reporting</Label>
                    <Select
                      value={formData.maps_reporting}
                      onValueChange={(value) => updateField("maps_reporting", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MAPS_REPORTING_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <span className="font-medium">{option.label}</span>
                              <span className="text-muted-foreground ml-2">
                                - {option.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Sample Submission</Label>
                    <Select
                      value={formData.sample_submission}
                      onValueChange={(value) => updateField("sample_submission", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SAMPLE_SUBMISSION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <span className="font-medium">{option.label}</span>
                              <span className="text-muted-foreground ml-2">
                                - {option.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">Cloud Extended Timeout</p>
                      <p className="text-xs text-muted-foreground">
                        Seconds to wait for cloud verdict (max 50)
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      className="w-20"
                      value={formData.cloud_extended_timeout || 50}
                      onChange={(e) =>
                        updateField("cloud_extended_timeout", parseInt(e.target.value))
                      }
                    />
                  </div>
                </TabsContent>

                {/* Advanced Settings */}
                <TabsContent value="advanced" className="mt-4 space-y-3">
                  {ADVANCED_SETTINGS.map((setting) => (
                    <div
                      key={setting.id}
                      className="flex items-center justify-between py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{setting.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {setting.description}
                        </p>
                      </div>
                      <Switch
                        checked={formData[setting.id as keyof DefenderPolicy] as boolean}
                        onCheckedChange={(checked) =>
                          updateField(setting.id as keyof DefenderPolicy, checked as never)
                        }
                      />
                    </div>
                  ))}
                </TabsContent>

                {/* ASR Rules */}
                <TabsContent value="asr" className="mt-4">
                  <div className="rounded-lg border border-border/40 bg-card p-4 mb-4">
                    <p className="text-sm text-muted-foreground">
                      Attack Surface Reduction rules help prevent actions and apps that are typically used by exploit-seeking malware.
                      <strong className="text-foreground"> Audit</strong> mode logs events without blocking,
                      <strong className="text-foreground"> Block</strong> mode actively prevents the behavior.
                    </p>
                  </div>
                  {ASR_RULES.map((rule) => (
                    <AsrRuleToggle
                      key={rule.id}
                      name={rule.name}
                      description={rule.description}
                      guid={rule.guid}
                      value={formData[rule.id as keyof DefenderPolicy] as AsrAction}
                      recommendedMode={rule.recommendedMode}
                      onChange={(value) =>
                        updateField(rule.id as keyof DefenderPolicy, value as never)
                      }
                    />
                  ))}
                </TabsContent>

                {/* Exclusions */}
                <TabsContent value="exclusions" className="mt-4">
                  <ExclusionsEditor
                    exclusionPaths={formData.exclusion_paths || []}
                    exclusionProcesses={formData.exclusion_processes || []}
                    exclusionExtensions={formData.exclusion_extensions || []}
                    onPathsChange={(paths) => updateField("exclusion_paths", paths)}
                    onProcessesChange={(processes) => updateField("exclusion_processes", processes)}
                    onExtensionsChange={(extensions) => updateField("exclusion_extensions", extensions)}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <Save className="h-4 w-4 mr-2" />
              {policy ? "Save Changes" : "Create Policy"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
