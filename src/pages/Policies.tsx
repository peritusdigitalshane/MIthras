import { useMemo, useState } from "react";
import { useEndpoints } from "@/hooks/useDashboardData";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText, Shield, AlertTriangle, CheckCircle, Loader2, Layers, ShieldCheck, RefreshCw, Monitor, Eye } from "lucide-react";
import { PolicyCard } from "@/components/policies/PolicyCard";
import { PolicyEditor } from "@/components/policies/PolicyEditor";
import { StatCard } from "@/components/ui/stat-card";
import { DefenderPolicy } from "@/lib/defender-settings";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useCreatePolicy, usePolicies, useUpdatePolicy } from "@/hooks/usePolicies";

// Import security components
import { ApplicationControl } from "@/components/security/ApplicationControl";
import { EndpointWdacList } from "@/components/security/EndpointWdacList";
import { UacPoliciesManager } from "@/components/security/UacPoliciesManager";
import { EndpointUacList } from "@/components/security/EndpointUacList";
import { WindowsUpdatePoliciesManager } from "@/components/security/WindowsUpdatePoliciesManager";
import { EndpointWindowsUpdateList } from "@/components/security/EndpointWindowsUpdateList";
import { AuditModeManager } from "@/components/policies/AuditModeManager";
import { PageHelp } from "@/components/help/PageHelp";

const Policies = () => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<DefenderPolicy | undefined>();
  
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const { currentOrganization, isLoading: tenantLoading } = useTenant();
  const { data: policies = [], isLoading: policiesLoading, error: policiesError } = usePolicies();
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const { data: endpoints = [] } = useEndpoints();

  const sanitizePolicyPatch = useMemo(() => {
    return (policyData: Partial<DefenderPolicy>) => {
      // Never allow client-side updates to move policies between orgs
      const { id, organization_id, created_at, updated_at, created_by, ...rest } = policyData as any;
      return rest as Partial<DefenderPolicy>;
    };
  }, []);

  const handleEdit = (policy: DefenderPolicy) => {
    setEditingPolicy(policy);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingPolicy(undefined);
    setEditorOpen(true);
  };

  const handleSave = async (policyData: Partial<DefenderPolicy>) => {
    if (!user || !currentOrganization) {
      toast({
        title: "Can't save policy",
        description: "Missing user session or organization.",
        variant: "destructive",
      });
      return;
    }

    const clean = sanitizePolicyPatch(policyData);

    try {
      if (editingPolicy) {
        await updatePolicy.mutateAsync({ id: editingPolicy.id, patch: clean });
        toast({
          title: "Policy updated",
          description: `${policyData.name} has been saved.`,
        });
      } else {
        await createPolicy.mutateAsync({ orgId: currentOrganization.id, userId: user.id, policy: clean });
        toast({
          title: "Policy created",
          description: `${policyData.name} has been created.`,
        });
      }
      setEditorOpen(false);
    } catch (e) {
      // MAJOR fix: actually surface the error. A blanket "Please try again"
      // hid the only feedback the admin had — usually RLS denials or
      // duplicate-name constraints, both of which retrying won't solve.
      const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
      const friendly = /row-level security|permission denied|policy/i.test(msg)
        ? `${msg} — your account may not have admin/owner access to this organisation.`
        : msg;
      toast({
        title: "Failed to save policy",
        description: friendly,
        variant: "destructive",
      });
    }
  };

  const totalAsrEnabled = policies.reduce((acc, p) => {
    const count = [
      p.asr_block_vulnerable_drivers,
      p.asr_block_email_executable,
      p.asr_block_office_child_process,
      p.asr_block_office_executable_content,
      p.asr_block_office_code_injection,
      p.asr_block_js_vbs_executable,
      p.asr_block_obfuscated_scripts,
      p.asr_block_office_macro_win32,
      p.asr_block_untrusted_executables,
      p.asr_advanced_ransomware_protection,
      p.asr_block_credential_stealing,
      p.asr_block_psexec_wmi,
      p.asr_block_usb_untrusted,
      p.asr_block_office_comms_child_process,
      p.asr_block_adobe_child_process,
      p.asr_block_wmi_persistence,
    ].filter(r => r === "enabled").length;
    return acc + count;
  }, 0);

  const endpointsCovered = endpoints.filter(e => e.policy_id !== null).length;
  const nonCompliant = endpoints.filter(e => e.policy_id === null).length;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">Policy Management</h1>
                <PageHelp
                  title="Policy Management"
                  glossaryAnchor="/glossary#default-policy"
                  whatIsThis={
                    <>
                      <p>
                        Policies are reusable configurations for the agents — Defender hardening,
                        Application Control, UAC, Windows Update, GPO, DNS, firewall. Each org
                        can have many; one is marked <b>default</b> and auto-applies to new
                        endpoints on enrolment.
                      </p>
                      <p>
                        Endpoints can override the default via direct assignment or via
                        membership in a group with its own assigned policy.
                      </p>
                    </>
                  }
                  tasks={[
                    { label: "Create or edit a policy in one of the tabs (Defender, App Control, etc.)" },
                    { label: "Mark it as Default so new endpoints inherit it automatically" },
                    { label: "Assign it to specific endpoints / groups for overrides" },
                    { label: "Test in Audit mode first, then flip to Enforce when ready" },
                  ]}
                  faq={[
                    {
                      q: "What's the difference between WDAC and AppWhitelist?",
                      a: (
                        <>
                          <p><b>WDAC</b> — kernel-level. Win10/11 Enterprise + Server 2016+. Zero race window, can't be killed from user space.</p>
                          <p><b>AppWhitelist</b> — user-mode WMI watcher. Works on all SKUs including EOL boxes. ~30s race window where a malicious binary briefly runs.</p>
                          <p>Mithras runs both side-by-side and uses each where supported.</p>
                        </>
                      ),
                    },
                    {
                      q: "What are ASR rules?",
                      a: <p>Attack Surface Reduction — Defender's 16+ hardening rules (e.g. "block Office child processes spawning EXE"). Set each to Block, Audit (log only), or Off.</p>,
                    },
                    {
                      q: "Audit vs Enforce — when do I switch?",
                      a: <p>Run in Audit for ~7 days, review what would have been blocked in /threats and /logs. Once you're confident no business processes are caught, flip to Enforce.</p>,
                    },
                  ]}
                />
              </div>
              <p className="text-muted-foreground">
                Configure Defender, Application Control, UAC, and Windows Update policies. Run in audit, then enforce.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content with Tabs */}
        <Tabs defaultValue="defender" className="space-y-6">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="defender" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Defender Policies</span>
            </TabsTrigger>
            <TabsTrigger value="app-control" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              <span className="hidden sm:inline">Application Control</span>
            </TabsTrigger>
            <TabsTrigger value="app-control-endpoints" className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              <span className="hidden sm:inline">App Control Endpoints</span>
            </TabsTrigger>
            <TabsTrigger value="uac-policies" className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">UAC Policies</span>
            </TabsTrigger>
            <TabsTrigger value="uac-status" className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              <span className="hidden sm:inline">UAC Endpoints</span>
            </TabsTrigger>
            <TabsTrigger value="wu-policies" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Update Policies</span>
            </TabsTrigger>
            <TabsTrigger value="wu-status" className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              <span className="hidden sm:inline">Update Endpoints</span>
            </TabsTrigger>
            <TabsTrigger value="learning" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Learning Mode</span>
            </TabsTrigger>
          </TabsList>

          {/* Defender Tab */}
          <TabsContent value="defender" className="space-y-6">
            {(authLoading || tenantLoading || policiesLoading) && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {policiesError && (
              <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                Failed to load policies.
              </div>
            )}

            {/* Header with Create Button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Defender Policies</h2>
                <p className="text-sm text-muted-foreground">
                  Configure Microsoft Defender settings and ASR rules
                </p>
              </div>
              <Button onClick={handleCreate} disabled={!currentOrganization}>
                <Plus className="mr-2 h-4 w-4" />
                Create Policy
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Policies"
                value={policies.length}
                icon={FileText}
              />
              <StatCard
                title="ASR Rules Enabled"
                value={totalAsrEnabled}
                icon={Shield}
                variant="success"
              />
              <StatCard
                title="Endpoints Covered"
                value={endpointsCovered}
                icon={CheckCircle}
              />
              <StatCard
                title="No Policy Assigned"
                value={nonCompliant}
                icon={AlertTriangle}
                variant={nonCompliant > 0 ? "warning" : "default"}
              />
            </div>

            {/* Policy Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {policies.map((policy) => (
                <PolicyCard key={policy.id} policy={policy} onEdit={handleEdit} />
              ))}
            </div>
          </TabsContent>

          {/* Application Control Tab */}
          <TabsContent value="app-control">
            <ApplicationControl />
          </TabsContent>

          {/* App Control Endpoints Tab */}
          <TabsContent value="app-control-endpoints">
            <EndpointWdacList />
          </TabsContent>

          {/* UAC Policies Tab */}
          <TabsContent value="uac-policies">
            <UacPoliciesManager />
          </TabsContent>

          {/* UAC Status Tab */}
          <TabsContent value="uac-status">
            <EndpointUacList />
          </TabsContent>

          {/* Windows Update Policies Tab */}
          <TabsContent value="wu-policies">
            <WindowsUpdatePoliciesManager />
          </TabsContent>

          {/* Windows Update Status Tab */}
          <TabsContent value="wu-status">
            <EndpointWindowsUpdateList />
          </TabsContent>

          {/* Learning Mode Tab */}
          <TabsContent value="learning" className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Learning Mode</h2>
              <p className="text-sm text-muted-foreground">
                Run policies in audit mode to baseline normal behavior before enforcing. Duration is flexible — extend or complete at any time.
              </p>
            </div>

            {policies.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Defender Policies</h3>
                {policies.map(p => (
                  <AuditModeManager key={p.id} policyType="defender" policyId={p.id} policyName={p.name} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Policy Editor */}
        {editorOpen && (
          <PolicyEditor
            policy={editingPolicy}
            onSave={handleSave}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default Policies;
