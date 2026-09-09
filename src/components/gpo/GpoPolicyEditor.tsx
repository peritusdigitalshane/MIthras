import { useState } from "react";
import { X, Save, Shield, Key, Eye, Lock, Monitor, Wifi, Settings2, Zap, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { GpoPolicy, CustomRegistrySetting } from "@/lib/gpo-settings";
import {
  AUDIT_OPTIONS,
  LAN_MANAGER_LEVELS,
  TELEMETRY_LEVELS,
  PASSWORD_SETTINGS,
  SECURITY_OPTION_TOGGLES,
  ADMIN_TEMPLATE_SYSTEM,
  ADMIN_TEMPLATE_NETWORK,
  ADMIN_TEMPLATE_COMPONENTS,
  REGISTRY_HIVES,
  REGISTRY_TYPES,
} from "@/lib/gpo-settings";

interface GpoPolicyEditorProps {
  policy?: GpoPolicy;
  onSave: (policy: Partial<GpoPolicy>) => void;
  onClose: () => void;
}

const defaultPolicy: Partial<GpoPolicy> = {
  name: "",
  description: "",
  is_default: false,
  password_min_length: 8,
  password_complexity_enabled: true,
  password_max_age_days: 90,
  password_min_age_days: 1,
  password_history_count: 12,
  password_reversible_encryption: false,
  lockout_threshold: 5,
  lockout_duration_minutes: 30,
  lockout_reset_minutes: 30,
  audit_logon_events: "success_failure",
  audit_object_access: "failure",
  audit_privilege_use: "failure",
  audit_policy_change: "success_failure",
  audit_account_management: "success_failure",
  audit_process_tracking: "none",
  audit_system_events: "success_failure",
  audit_account_logon: "success_failure",
  audit_ds_access: "none",
  interactive_logon_message_title: "",
  interactive_logon_message_text: "",
  interactive_logon_require_ctrl_alt_del: true,
  interactive_logon_dont_display_last_user: false,
  network_access_restrict_anonymous: true,
  network_security_lan_manager_level: 5,
  network_security_min_session_security_ntlm: true,
  shutdown_clear_virtual_memory: false,
  devices_restrict_cd_rom: false,
  devices_restrict_floppy: false,
  system_objects_strengthen_default_permissions: true,
  right_network_logon: [],
  right_deny_network_logon: [],
  right_local_logon: [],
  right_deny_local_logon: [],
  right_remote_desktop_logon: [],
  right_deny_remote_desktop_logon: [],
  right_shut_down_system: [],
  right_change_system_time: [],
  right_debug_programs: [],
  disable_registry_tools: false,
  disable_task_manager: false,
  disable_cmd_prompt: false,
  disable_run_command: false,
  disable_control_panel: false,
  disable_lock_screen_camera: false,
  disable_ipv6: false,
  disable_wifi_sense: true,
  enable_windows_firewall_domain: true,
  enable_windows_firewall_private: true,
  enable_windows_firewall_public: true,
  disable_telemetry: false,
  telemetry_level: 1,
  disable_cortana: false,
  disable_consumer_features: true,
  disable_store_apps: false,
  disable_onedrive: false,
  disable_game_bar: true,
  screen_timeout_ac_minutes: 15,
  screen_timeout_dc_minutes: 5,
  sleep_timeout_ac_minutes: 30,
  sleep_timeout_dc_minutes: 15,
  require_password_on_wake: true,
  remote_desktop_enabled: false,
  remote_desktop_nla_required: true,
  remote_desktop_max_sessions: 2,
  custom_registry_settings: [],
};

export function GpoPolicyEditor({ policy, onSave, onClose }: GpoPolicyEditorProps) {
  const [formData, setFormData] = useState<Partial<GpoPolicy>>(policy || defaultPolicy);

  const updateField = <K extends keyof GpoPolicy>(field: K, value: GpoPolicy[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const auditFields = [
    { id: "audit_logon_events", label: "Logon Events" },
    { id: "audit_object_access", label: "Object Access" },
    { id: "audit_privilege_use", label: "Privilege Use" },
    { id: "audit_policy_change", label: "Policy Change" },
    { id: "audit_account_management", label: "Account Management" },
    { id: "audit_process_tracking", label: "Process Tracking" },
    { id: "audit_system_events", label: "System Events" },
    { id: "audit_account_logon", label: "Account Logon" },
    { id: "audit_ds_access", label: "Directory Service Access" },
  ];

  const addCustomRegistry = () => {
    const current = (formData.custom_registry_settings || []) as CustomRegistrySetting[];
    updateField("custom_registry_settings", [...current, { hive: "HKLM", path: "", name: "", type: "REG_DWORD", value: "" }]);
  };

  const updateCustomRegistry = (index: number, field: keyof CustomRegistrySetting, value: string) => {
    const current = [...((formData.custom_registry_settings || []) as CustomRegistrySetting[])];
    current[index] = { ...current[index], [field]: value };
    updateField("custom_registry_settings", current);
  };

  const removeCustomRegistry = (index: number) => {
    const current = [...((formData.custom_registry_settings || []) as CustomRegistrySetting[])];
    current.splice(index, 1);
    updateField("custom_registry_settings", current);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-y-0 right-0 w-full max-w-3xl bg-background border-l border-border shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{policy ? "Edit GPO Policy" : "Create GPO Policy"}</h2>
                <p className="text-sm text-muted-foreground">Configure Group Policy settings for endpoints</p>
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
                  <Input id="name" value={formData.name || ""} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g., Hardened Workstation GPO" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" value={formData.description || ""} onChange={(e) => updateField("description", e.target.value)} placeholder="Optional description" />
                </div>
              </div>

              <Tabs defaultValue="password" className="w-full">
                <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
                  <TabsTrigger value="password" className="text-xs"><Key className="h-3.5 w-3.5 mr-1" />Password</TabsTrigger>
                  <TabsTrigger value="audit" className="text-xs"><Eye className="h-3.5 w-3.5 mr-1" />Audit</TabsTrigger>
                  <TabsTrigger value="security" className="text-xs"><Lock className="h-3.5 w-3.5 mr-1" />Security</TabsTrigger>
                  <TabsTrigger value="system" className="text-xs"><Monitor className="h-3.5 w-3.5 mr-1" />System</TabsTrigger>
                  <TabsTrigger value="network" className="text-xs"><Wifi className="h-3.5 w-3.5 mr-1" />Network</TabsTrigger>
                  <TabsTrigger value="components" className="text-xs"><Settings2 className="h-3.5 w-3.5 mr-1" />Components</TabsTrigger>
                  <TabsTrigger value="power" className="text-xs"><Zap className="h-3.5 w-3.5 mr-1" />Power</TabsTrigger>
                  <TabsTrigger value="registry" className="text-xs"><SquareTerminal className="h-3.5 w-3.5 mr-1" />Registry</TabsTrigger>
                </TabsList>

                {/* Password & Account Lockout */}
                <TabsContent value="password" className="mt-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Password Policy</h3>
                    <div className="space-y-3">
                      <NumberField label="Minimum Password Length" value={formData.password_min_length || 8} min={0} max={128} onChange={(v) => updateField("password_min_length", v)} />
                      <NumberField label="Maximum Password Age (days)" value={formData.password_max_age_days || 90} min={0} max={999} onChange={(v) => updateField("password_max_age_days", v)} />
                      <NumberField label="Minimum Password Age (days)" value={formData.password_min_age_days || 1} min={0} max={998} onChange={(v) => updateField("password_min_age_days", v)} />
                      <NumberField label="Password History (remembered)" value={formData.password_history_count || 12} min={0} max={24} onChange={(v) => updateField("password_history_count", v)} />
                      {PASSWORD_SETTINGS.map((s) => (
                        <ToggleRow key={s.id} name={s.name} description={s.description} checked={formData[s.id as keyof GpoPolicy] as boolean} onChange={(c) => updateField(s.id as keyof GpoPolicy, c as never)} />
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Account Lockout Policy</h3>
                    <div className="space-y-3">
                      <NumberField label="Lockout Threshold (attempts, 0 = disabled)" value={formData.lockout_threshold || 0} min={0} max={999} onChange={(v) => updateField("lockout_threshold", v)} />
                      <NumberField label="Lockout Duration (minutes)" value={formData.lockout_duration_minutes || 30} min={0} max={99999} onChange={(v) => updateField("lockout_duration_minutes", v)} />
                      <NumberField label="Reset Counter After (minutes)" value={formData.lockout_reset_minutes || 30} min={0} max={99999} onChange={(v) => updateField("lockout_reset_minutes", v)} />
                    </div>
                  </div>
                </TabsContent>

                {/* Audit Policy */}
                <TabsContent value="audit" className="mt-4 space-y-3">
                  <div className="rounded-lg border border-border/40 bg-card p-4 mb-4">
                    <p className="text-sm text-muted-foreground">
                      Configure which categories of events Windows should audit.
                      <strong className="text-foreground"> Success</strong> logs allowed actions,
                      <strong className="text-foreground"> Failure</strong> logs denied actions.
                    </p>
                  </div>
                  {auditFields.map((af) => (
                    <div key={af.id} className="flex items-center justify-between py-2">
                      <p className="text-sm font-medium">{af.label}</p>
                      <Select value={formData[af.id as keyof GpoPolicy] as string} onValueChange={(v) => updateField(af.id as keyof GpoPolicy, v as never)}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AUDIT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </TabsContent>

                {/* Security Options */}
                <TabsContent value="security" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Interactive Logon Message Title</Label>
                    <Input value={formData.interactive_logon_message_title || ""} onChange={(e) => updateField("interactive_logon_message_title", e.target.value)} placeholder="e.g., Authorized Personnel Only" />
                  </div>
                  <div className="space-y-2">
                    <Label>Interactive Logon Message Text</Label>
                    <Textarea value={formData.interactive_logon_message_text || ""} onChange={(e) => updateField("interactive_logon_message_text", e.target.value)} placeholder="Legal notice text shown at logon..." rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>LAN Manager Authentication Level</Label>
                    <Select value={String(formData.network_security_lan_manager_level ?? 5)} onValueChange={(v) => updateField("network_security_lan_manager_level", parseInt(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LAN_MANAGER_LEVELS.map((l) => <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  {SECURITY_OPTION_TOGGLES.map((s) => (
                    <ToggleRow key={s.id} name={s.name} description={s.description} checked={formData[s.id as keyof GpoPolicy] as boolean} onChange={(c) => updateField(s.id as keyof GpoPolicy, c as never)} />
                  ))}
                </TabsContent>

                {/* Admin Templates - System */}
                <TabsContent value="system" className="mt-4 space-y-3">
                  <div className="rounded-lg border border-border/40 bg-card p-4 mb-4">
                    <p className="text-sm text-muted-foreground">Restrict access to system tools and features. These settings apply to all users on the endpoint.</p>
                  </div>
                  {ADMIN_TEMPLATE_SYSTEM.map((s) => (
                    <ToggleRow key={s.id} name={s.name} description={s.description} checked={formData[s.id as keyof GpoPolicy] as boolean} onChange={(c) => updateField(s.id as keyof GpoPolicy, c as never)} />
                  ))}
                  <Separator className="my-4" />
                  <h3 className="text-sm font-semibold text-foreground">Remote Desktop</h3>
                  <ToggleRow name="Enable Remote Desktop" description="Allow remote connections to this computer" checked={formData.remote_desktop_enabled || false} onChange={(c) => updateField("remote_desktop_enabled", c)} />
                  <ToggleRow name="Require NLA" description="Require Network Level Authentication for RDP connections" checked={formData.remote_desktop_nla_required || false} onChange={(c) => updateField("remote_desktop_nla_required", c)} />
                  <NumberField label="Max RDP Sessions" value={formData.remote_desktop_max_sessions || 2} min={1} max={10} onChange={(v) => updateField("remote_desktop_max_sessions", v)} />
                </TabsContent>

                {/* Admin Templates - Network */}
                <TabsContent value="network" className="mt-4 space-y-3">
                  {ADMIN_TEMPLATE_NETWORK.map((s) => (
                    <ToggleRow key={s.id} name={s.name} description={s.description} checked={formData[s.id as keyof GpoPolicy] as boolean} onChange={(c) => updateField(s.id as keyof GpoPolicy, c as never)} />
                  ))}
                </TabsContent>

                {/* Admin Templates - Windows Components */}
                <TabsContent value="components" className="mt-4 space-y-3">
                  {ADMIN_TEMPLATE_COMPONENTS.map((s) => (
                    <ToggleRow key={s.id} name={s.name} description={s.description} checked={formData[s.id as keyof GpoPolicy] as boolean} onChange={(c) => updateField(s.id as keyof GpoPolicy, c as never)} />
                  ))}
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <Label>Telemetry Level</Label>
                    <Select value={String(formData.telemetry_level ?? 1)} onValueChange={(v) => updateField("telemetry_level", parseInt(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TELEMETRY_LEVELS.map((l) => <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>

                {/* Power Settings */}
                <TabsContent value="power" className="mt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Screen Timeout</h3>
                  <NumberField label="Plugged In (minutes)" value={formData.screen_timeout_ac_minutes || 15} min={0} max={9999} onChange={(v) => updateField("screen_timeout_ac_minutes", v)} />
                  <NumberField label="On Battery (minutes)" value={formData.screen_timeout_dc_minutes || 5} min={0} max={9999} onChange={(v) => updateField("screen_timeout_dc_minutes", v)} />
                  <Separator className="my-4" />
                  <h3 className="text-sm font-semibold text-foreground">Sleep Timeout</h3>
                  <NumberField label="Plugged In (minutes)" value={formData.sleep_timeout_ac_minutes || 30} min={0} max={9999} onChange={(v) => updateField("sleep_timeout_ac_minutes", v)} />
                  <NumberField label="On Battery (minutes)" value={formData.sleep_timeout_dc_minutes || 15} min={0} max={9999} onChange={(v) => updateField("sleep_timeout_dc_minutes", v)} />
                  <Separator className="my-4" />
                  <ToggleRow name="Require Password on Wake" description="Prompt for password when the computer wakes from sleep" checked={formData.require_password_on_wake || false} onChange={(c) => updateField("require_password_on_wake", c)} />
                </TabsContent>

                {/* Custom Registry */}
                <TabsContent value="registry" className="mt-4 space-y-4">
                  <div className="rounded-lg border border-border/40 bg-card p-4 mb-4">
                    <p className="text-sm text-muted-foreground">
                      Define custom registry key/value pairs to push to endpoints. These are applied via PowerShell <code className="text-xs bg-muted px-1 rounded">Set-ItemProperty</code>.
                    </p>
                  </div>
                  {((formData.custom_registry_settings || []) as CustomRegistrySetting[]).map((reg, i) => (
                    <div key={i} className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-medium">Entry #{i + 1}</p>
                        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeCustomRegistry(i)}>Remove</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Hive</Label>
                          <Select value={reg.hive} onValueChange={(v) => updateCustomRegistry(i, "hive", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{REGISTRY_HIVES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select value={reg.type} onValueChange={(v) => updateCustomRegistry(i, "type", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{REGISTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Path</Label>
                        <Input value={reg.path} onChange={(e) => updateCustomRegistry(i, "path", e.target.value)} placeholder="SOFTWARE\Policies\Microsoft\..." className="font-mono text-xs" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Name</Label>
                          <Input value={reg.name} onChange={(e) => updateCustomRegistry(i, "name", e.target.value)} placeholder="ValueName" className="font-mono text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Value</Label>
                          <Input value={reg.value} onChange={(e) => updateCustomRegistry(i, "value", e.target.value)} placeholder="1" className="font-mono text-xs" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={addCustomRegistry}>+ Add Registry Entry</Button>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit"><Save className="h-4 w-4 mr-2" />{policy ? "Save Changes" : "Create Policy"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper components
function ToggleRow({ name, description, checked, onChange }: { name: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm font-medium">{label}</p>
      <Input type="number" min={min} max={max} className="w-24" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
    </div>
  );
}
