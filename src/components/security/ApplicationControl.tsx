import { useState, useMemo } from "react";
import { useWdacDiscoveredApps, WdacDiscoveredApp } from "@/hooks/useWdac";
import { useRuleSets, useRuleSetRules, useRuleSetMutations, useAllRuleSetRules, RuleSet, RuleSetRule } from "@/hooks/useRuleSets";
import { RuleSetAuditCountdown } from "./RuleSetAuditCountdown";
import { useWdacTemplates } from "@/hooks/useWdacTemplates";
import { RuleSetRingsPanel } from "./RuleSetRingsPanel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Search,
  Package,
  Loader2,
  CheckCircle2,
  XCircle,
  Layers,
  Crosshair,
  Copy,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Edit,
  ShieldCheck,
  ShieldOff,
  ArrowLeft,
  Building2,
  Info,
  Eye,
} from "lucide-react";

interface PublisherGroup {
  publisher: string;
  apps: WdacDiscoveredApp[];
  hasRules: boolean;
}

interface RuleStatus {
  ruleSetName: string;
  action: "allow" | "block";
  ruleType: string;
}

export function ApplicationControl() {
  const { data: apps, isLoading: appsLoading } = useWdacDiscoveredApps();
  const { data: ruleSets, isLoading: ruleSetsLoading } = useRuleSets();
  const { createRuleSet, addRule, addRulesBulk, deleteRule: deleteRuleSetRule, updateRuleSet, deleteRuleSet } = useRuleSetMutations();
  const { data: templates } = useWdacTemplates();
  
  // Fetch all rules across all rule sets for status indicators
  const ruleSetIds = useMemo(() => (ruleSets || []).map(rs => rs.id), [ruleSets]);
  const { data: allRules } = useAllRuleSetRules(ruleSetIds);
  
  const navigate = useNavigate();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [expandedPublishers, setExpandedPublishers] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"apps" | "rulesets">("apps");

  // Rule set detail view
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(null);
  const { data: selectedRules, isLoading: rulesLoading } = useRuleSetRules(selectedRuleSetId);

  // Dialogs
  const [showRuleSetEditor, setShowRuleSetEditor] = useState(false);
  const [editingRuleSet, setEditingRuleSet] = useState<RuleSet | null>(null);
  const [ruleSetForm, setRuleSetForm] = useState({ name: "", description: "", mode: "audit" as "audit" | "enforced" });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    rule_type: "publisher" as RuleSetRule["rule_type"],
    action: "allow" as RuleSetRule["action"],
    value: "",
    publisher_name: "",
    product_name: "",
    description: "",
  });

  // Build lookup maps for rule statuses
  const publisherRuleStatuses = useMemo(() => {
    const map = new Map<string, RuleStatus[]>();
    if (!allRules) return map;
    allRules.forEach(rule => {
      if (rule.rule_type === "publisher" && rule.value) {
        const key = rule.value.toLowerCase();
        const existing = map.get(key) || [];
        existing.push({ ruleSetName: rule.rule_set_name, action: rule.action as "allow" | "block", ruleType: rule.rule_type });
        map.set(key, existing);
      }
    });
    return map;
  }, [allRules]);

  const appRuleStatuses = useMemo(() => {
    const map = new Map<string, RuleStatus[]>(); // keyed by file_name, file_path, or file_hash
    if (!allRules) return map;
    allRules.forEach(rule => {
      const key = rule.value?.toLowerCase();
      if (!key) return;
      const existing = map.get(key) || [];
      existing.push({ ruleSetName: rule.rule_set_name, action: rule.action as "allow" | "block", ruleType: rule.rule_type });
      map.set(key, existing);
    });
    return map;
  }, [allRules]);

  // Group apps by publisher
  const publisherGroups = useMemo((): PublisherGroup[] => {
    if (!apps) return [];
    const searchLower = search.toLowerCase();
    const filtered = apps.filter((app) =>
      app.file_name.toLowerCase().includes(searchLower) ||
      app.file_path.toLowerCase().includes(searchLower) ||
      app.publisher?.toLowerCase().includes(searchLower) ||
      app.product_name?.toLowerCase().includes(searchLower) ||
      app.endpoints?.hostname?.toLowerCase().includes(searchLower)
    );

    const groupMap = new Map<string, WdacDiscoveredApp[]>();
    filtered.forEach((app) => {
      const key = app.publisher || "Unknown Publisher";
      const group = groupMap.get(key) || [];
      group.push(app);
      groupMap.set(key, group);
    });

    return Array.from(groupMap.entries())
      .map(([publisher, apps]) => ({
        publisher,
        apps: apps.sort((a, b) => a.file_name.localeCompare(b.file_name)),
        hasRules: false,
      }))
      .sort((a, b) => b.apps.length - a.apps.length);
  }, [apps, search]);

  const totalApps = apps?.length || 0;
  const uniquePublishers = publisherGroups.length;

  const togglePublisher = (publisher: string) => {
    const next = new Set(expandedPublishers);
    if (next.has(publisher)) next.delete(publisher);
    else next.add(publisher);
    setExpandedPublishers(next);
  };

  // Get rule statuses for a publisher
  const getPublisherStatuses = (publisher: string): RuleStatus[] => {
    return publisherRuleStatuses.get(publisher.toLowerCase()) || [];
  };

  // Get rule statuses for an app (checks file_name, path, hash, and publisher)
  const getAppStatuses = (app: WdacDiscoveredApp): RuleStatus[] => {
    const statuses: RuleStatus[] = [];
    const seen = new Set<string>();
    const addUnique = (items: RuleStatus[]) => {
      items.forEach(s => {
        const key = `${s.ruleSetName}-${s.action}-${s.ruleType}`;
        if (!seen.has(key)) { seen.add(key); statuses.push(s); }
      });
    };
    addUnique(appRuleStatuses.get(app.file_name.toLowerCase()) || []);
    addUnique(appRuleStatuses.get(app.file_path.toLowerCase()) || []);
    if (app.file_hash) addUnique(appRuleStatuses.get(app.file_hash.toLowerCase()) || []);
    if (app.publisher) addUnique(publisherRuleStatuses.get(app.publisher.toLowerCase()) || []);
    return statuses;
  };

  const renderStatusBadges = (statuses: RuleStatus[]) => {
    if (!statuses.length) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {statuses.map((s, i) => (
          <Badge
            key={i}
            variant="outline"
            className={s.action === "allow" 
              ? "border-status-healthy/50 text-status-healthy bg-status-healthy/10 text-xs" 
              : "border-status-critical/50 text-status-critical bg-status-critical/10 text-xs"
            }
          >
            {s.action === "allow" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
            {s.ruleSetName}
          </Badge>
        ))}
      </div>
    );
  };

  // Quick actions
  const handleQuickAllow = (app: WdacDiscoveredApp, ruleSetId: string, type: "publisher" | "path" | "hash" | "file_name") => {
    let value = "";
    switch (type) {
      case "publisher": value = app.publisher || app.file_name; break;
      case "path": value = app.file_path; break;
      case "hash": value = app.file_hash || ""; break;
      case "file_name": value = app.file_name; break;
    }
    if (!value) { toast({ title: "No value available for this rule type", variant: "destructive" }); return; }
    addRule.mutate({
      rule_set_id: ruleSetId,
      rule_type: type,
      action: "allow",
      value,
      publisher_name: app.publisher || null,
      product_name: app.product_name || null,
      file_version_min: null,
      description: `Allowed: ${app.file_name}`,
    });
  };

  const handleQuickBlock = (app: WdacDiscoveredApp, ruleSetId: string, type: "publisher" | "path" | "hash" | "file_name") => {
    let value = "";
    switch (type) {
      case "publisher": value = app.publisher || app.file_name; break;
      case "path": value = app.file_path; break;
      case "hash": value = app.file_hash || ""; break;
      case "file_name": value = app.file_name; break;
    }
    if (!value) { toast({ title: "No value available for this rule type", variant: "destructive" }); return; }
    addRule.mutate({
      rule_set_id: ruleSetId,
      rule_type: type,
      action: "block",
      value,
      publisher_name: app.publisher || null,
      product_name: app.product_name || null,
      file_version_min: null,
      description: `Blocked: ${app.file_name}`,
    });
  };

  const handleTrustPublisher = (publisher: string, ruleSetId: string) => {
    addRule.mutate({
      rule_set_id: ruleSetId,
      rule_type: "publisher",
      action: "allow",
      value: publisher,
      publisher_name: publisher,
      product_name: null,
      file_version_min: null,
      description: `Trust all apps from ${publisher}`,
    });
  };

  const handleBlockPublisher = (publisher: string, ruleSetId: string) => {
    addRule.mutate({
      rule_set_id: ruleSetId,
      rule_type: "publisher",
      action: "block",
      value: publisher,
      publisher_name: publisher,
      product_name: null,
      file_version_min: null,
      description: `Block all apps from ${publisher}`,
    });
  };

  // Trust All Publishers - creates a baseline by allowing every known publisher
  const handleTrustAllPublishers = (ruleSetId: string) => {
    const knownPublishers = publisherGroups
      .filter(g => g.publisher !== "Unknown Publisher")
      .map(g => g.publisher);
    
    if (!knownPublishers.length) {
      toast({ title: "No known publishers to trust", variant: "destructive" });
      return;
    }

    // Filter out publishers already allowed in this rule set
    const ruleSet = ruleSets?.find(rs => rs.id === ruleSetId);
    const existingAllowed = new Set(
      (allRules || [])
        .filter(r => r.rule_set_id === ruleSetId && r.rule_type === "publisher" && r.action === "allow")
        .map(r => r.value.toLowerCase())
    );
    const newPublishers = knownPublishers.filter(p => !existingAllowed.has(p.toLowerCase()));

    if (!newPublishers.length) {
      toast({ title: "All publishers are already trusted in this rule set" });
      return;
    }

    const rules = newPublishers.map(publisher => ({
      rule_set_id: ruleSetId,
      rule_type: "publisher" as const,
      action: "allow" as const,
      value: publisher,
      publisher_name: publisher,
      product_name: null,
      file_version_min: null,
      description: `Baseline: Trust ${publisher}`,
    }));

    addRulesBulk.mutate(rules);
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    toast({ title: "Hash copied to clipboard" });
  };

  // Rule Set CRUD
  const handleCreateRuleSet = () => {
    setEditingRuleSet(null);
    setRuleSetForm({ name: "", description: "", mode: "audit" });
    setShowRuleSetEditor(true);
  };

  const handleEditRuleSet = (rs: RuleSet, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRuleSet(rs);
    setRuleSetForm({ name: rs.name, description: rs.description || "", mode: rs.mode || "audit" });
    setShowRuleSetEditor(true);
  };

  const handleSaveRuleSet = async () => {
    if (editingRuleSet) {
      updateRuleSet.mutate({ id: editingRuleSet.id, ...ruleSetForm });
      setShowRuleSetEditor(false);
    } else {
      try {
        const newRuleSet = await createRuleSet.mutateAsync(ruleSetForm);
        if (selectedTemplateId) {
          const template = (templates ?? []).find((t) => t.id === selectedTemplateId);
          if (template?.rules?.length) {
            await addRulesBulk.mutateAsync(
              template.rules.map((r) => ({
                rule_set_id: newRuleSet.id,
                rule_type: r.rule_type,
                action: r.action,
                value: r.value,
                publisher_name: r.publisher_name,
                product_name: r.product_name,
                file_version_min: r.file_version_min,
                description: r.description,
              }))
            );
          }
        }
      } finally {
        setShowRuleSetEditor(false);
        setSelectedTemplateId(null);
      }
    }
  };

  const handleDeleteRuleSet = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this rule set? All rules within it will also be deleted.")) {
      deleteRuleSet.mutate(id);
      if (selectedRuleSetId === id) setSelectedRuleSetId(null);
    }
  };

  const handleAddManualRule = () => {
    if (!selectedRuleSetId || !ruleForm.value) return;
    addRule.mutate({
      rule_set_id: selectedRuleSetId,
      ...ruleForm,
      file_version_min: null,
      publisher_name: ruleForm.publisher_name || null,
      product_name: ruleForm.product_name || null,
    });
    setShowAddRule(false);
    setRuleForm({ rule_type: "publisher", action: "allow", value: "", publisher_name: "", product_name: "", description: "" });
  };

  const getRuleTypeLabel = (type: string) => {
    switch (type) {
      case "publisher": return "Publisher";
      case "path": return "File Path";
      case "hash": return "File Hash";
      case "file_name": return "File Name";
      default: return type;
    }
  };

  const isLoading = appsLoading || ruleSetsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedRuleSet = ruleSets?.find(rs => rs.id === selectedRuleSetId);

  // Rule Set detail view
  if (selectedRuleSetId && selectedRuleSet) {
    const allowRules = selectedRules?.filter(r => r.action === "allow") || [];
    const blockRules = selectedRules?.filter(r => r.action === "block") || [];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setSelectedRuleSetId(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{selectedRuleSet.name}</h2>
                <Badge
                  variant={selectedRuleSet.mode === "enforced" ? "default" : "secondary"}
                  className={
                    selectedRuleSet.mode === "enforced"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                  }
                >
                  {selectedRuleSet.mode === "enforced" ? (
                    <ShieldCheck className="h-3 w-3 mr-1" />
                  ) : (
                    <Eye className="h-3 w-3 mr-1" />
                  )}
                  {selectedRuleSet.mode === "enforced" ? "Enforced" : "Audit"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedRuleSet.description || "No description"} • {selectedRules?.length || 0} rules
              </p>
            </div>
          </div>
          <Button onClick={() => setShowAddRule(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>

        {rulesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Allow Rules ({allowRules.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!allowRules.length ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No allow rules yet.</p>
                ) : (
                  <ScrollArea className="h-[250px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allowRules.map(rule => (
                          <TableRow key={rule.id}>
                            <TableCell><Badge variant="secondary">{getRuleTypeLabel(rule.rule_type)}</Badge></TableCell>
                            <TableCell className="font-mono text-sm max-w-[300px] truncate">{rule.value}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{rule.description || "-"}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => { if (confirm("Delete this rule?")) deleteRuleSetRule.mutate({ id: rule.id, ruleSetId: rule.rule_set_id }); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Block Rules ({blockRules.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!blockRules.length ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No block rules yet.</p>
                ) : (
                  <ScrollArea className="h-[250px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {blockRules.map(rule => (
                          <TableRow key={rule.id}>
                            <TableCell><Badge variant="secondary">{getRuleTypeLabel(rule.rule_type)}</Badge></TableCell>
                            <TableCell className="font-mono text-sm max-w-[300px] truncate">{rule.value}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{rule.description || "-"}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => { if (confirm("Delete this rule?")) deleteRuleSetRule.mutate({ id: rule.id, ruleSetId: rule.rule_set_id }); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <RuleSetRingsPanel ruleSetId={selectedRuleSetId!} />

        {/* Add Rule Dialog */}
        <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Rule to "{selectedRuleSet.name}"</DialogTitle>
              <DialogDescription>Create a new allow or block rule.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={ruleForm.action} onValueChange={(v: "allow" | "block") => setRuleForm({ ...ruleForm, action: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Allow</div></SelectItem>
                      <SelectItem value="block"><div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" />Block</div></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rule Type</Label>
                  <Select value={ruleForm.rule_type} onValueChange={(v: RuleSetRule["rule_type"]) => setRuleForm({ ...ruleForm, rule_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="publisher">Publisher</SelectItem>
                      <SelectItem value="path">File Path</SelectItem>
                      <SelectItem value="hash">File Hash</SelectItem>
                      <SelectItem value="file_name">File Name</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Value *</Label>
                <Input value={ruleForm.value} onChange={(e) => setRuleForm({ ...ruleForm, value: e.target.value })}
                  placeholder={ruleForm.rule_type === "publisher" ? "O=Microsoft Corporation..." : ruleForm.rule_type === "path" ? "C:\\Program Files\\*" : ruleForm.rule_type === "hash" ? "SHA256 hash..." : "notepad.exe"} />
              </div>
              {ruleForm.rule_type === "publisher" && (
                <>
                  <div className="space-y-2">
                    <Label>Publisher Name</Label>
                    <Input value={ruleForm.publisher_name} onChange={(e) => setRuleForm({ ...ruleForm, publisher_name: e.target.value })} placeholder="Microsoft Corporation" />
                  </div>
                  <div className="space-y-2">
                    <Label>Product Name</Label>
                    <Input value={ruleForm.product_name} onChange={(e) => setRuleForm({ ...ruleForm, product_name: e.target.value })} placeholder="Windows" />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={ruleForm.description} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} placeholder="Why this rule exists..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
              <Button onClick={handleAddManualRule} disabled={!ruleForm.value || addRule.isPending}>
                {addRule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Main view with sub-tabs
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Application Control</h2>
        <p className="text-sm text-muted-foreground">
          Discover applications across endpoints and manage allow/block rules. Group apps by publisher for quick whitelisting.
        </p>
      </div>

      {/* Info banner */}
      {!ruleSets?.length && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground mb-1">Getting Started</p>
              <p className="text-muted-foreground">
                Create a <strong>Rule Set</strong> first — it's a named collection of allow/block rules. Then you can whitelist apps
                directly from the discovered apps list with one click. Assign rule sets to endpoints or groups to enforce them.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Discovered Apps</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalApps}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Publishers</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{uniquePublishers}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Rule Sets</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{ruleSets?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Rules</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{ruleSets?.reduce((acc, rs) => acc + (rs.rule_count || 0), 0) || 0}</div></CardContent>
        </Card>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "apps" | "rulesets")}>
        <TabsList>
          <TabsTrigger value="apps" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Discovered Apps
          </TabsTrigger>
          <TabsTrigger value="rulesets" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Rule Sets
          </TabsTrigger>
        </TabsList>

        {/* ============ DISCOVERED APPS TAB ============ */}
        <TabsContent value="apps" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name, path, publisher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            {ruleSets && ruleSets.length > 0 && publisherGroups.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Trust All Publishers
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Create Baseline</p>
                    <p className="text-xs text-muted-foreground">
                      Trust all {publisherGroups.filter(g => g.publisher !== "Unknown Publisher").length} known publishers in a rule set. You can then selectively block individual publishers afterward.
                    </p>
                    {ruleSets.map(rs => (
                      <Button key={rs.id} variant="ghost" size="sm" className="w-full justify-start text-sm"
                        onClick={() => handleTrustAllPublishers(rs.id)}
                        disabled={addRulesBulk.isPending}>
                        {addRulesBulk.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Layers className="h-3 w-3 mr-2" />}
                        {rs.name}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {!publisherGroups.length ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium text-foreground mb-1">No Applications Discovered</h3>
                <p className="text-sm text-muted-foreground">Applications will appear here once agents report their inventory</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {publisherGroups.map((group) => (
                <Card key={group.publisher}>
                  <Collapsible open={expandedPublishers.has(group.publisher)} onOpenChange={() => togglePublisher(group.publisher)}>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            {expandedPublishers.has(group.publisher) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {group.publisher}
                            {renderStatusBadges(getPublisherStatuses(group.publisher))}
                          </div>
                          <div className="text-xs text-muted-foreground">{group.apps.length} application{group.apps.length !== 1 ? "s" : ""}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {ruleSets && ruleSets.length > 0 && group.publisher !== "Unknown Publisher" && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm">
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                Trust Publisher
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56" align="end">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Add to Rule Set</p>
                                <p className="text-xs text-muted-foreground">Allow all apps from "{group.publisher}"</p>
                                {ruleSets.map(rs => (
                                  <Button key={rs.id} variant="ghost" size="sm" className="w-full justify-start text-sm"
                                    onClick={() => handleTrustPublisher(group.publisher, rs.id)}
                                    disabled={addRule.isPending}>
                                    <Layers className="h-3 w-3 mr-2" />{rs.name}
                                  </Button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                        {ruleSets && ruleSets.length > 0 && group.publisher !== "Unknown Publisher" && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                                <ShieldOff className="h-4 w-4 mr-2" />
                                Block
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56" align="end">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Block Publisher</p>
                                <p className="text-xs text-muted-foreground">Block all apps from "{group.publisher}"</p>
                                {ruleSets.map(rs => (
                                  <Button key={rs.id} variant="ghost" size="sm" className="w-full justify-start text-sm"
                                    onClick={() => handleBlockPublisher(group.publisher, rs.id)}
                                    disabled={addRule.isPending}>
                                    <Layers className="h-3 w-3 mr-2" />{rs.name}
                                  </Button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                        <Badge variant="secondary">{group.apps.length}</Badge>
                      </div>
                    </div>

                    <CollapsibleContent>
                      <div className="border-t px-4 py-2">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Application</TableHead>
                              <TableHead>Hash</TableHead>
                              <TableHead>Endpoint</TableHead>
                              <TableHead>Last Seen</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.apps.map((app) => (
                              <TableRow key={app.id}>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="space-y-0.5">
                                      <div className="font-medium text-sm">{app.file_name}</div>
                                      <div className="text-xs text-muted-foreground truncate max-w-[250px]">{app.file_path}</div>
                                      {app.product_name && <div className="text-xs text-muted-foreground">{app.product_name} {app.file_version || ""}</div>}
                                    </div>
                                    {renderStatusBadges(getAppStatuses(app))}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {app.file_hash ? (
                                    <div className="flex items-center gap-1">
                                      <code className="text-xs font-mono text-muted-foreground truncate max-w-[100px]" title={app.file_hash}>
                                        {app.file_hash.substring(0, 12)}…
                                      </code>
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyHash(app.file_hash!)} title="Copy hash">
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-sm">{app.endpoints?.hostname || "Unknown"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{format(new Date(app.last_seen_at), "MMM d, HH:mm")}</TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    {ruleSets && ruleSets.length > 0 && (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <Button variant="ghost" size="sm" className="h-7 text-xs">
                                            <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                                            Allow
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-64" align="end">
                                          <div className="space-y-3">
                                            <p className="text-sm font-medium">Allow "{app.file_name}"</p>
                                            <div className="space-y-1">
                                              <p className="text-xs text-muted-foreground font-medium">Match by:</p>
                                              {ruleSets.map(rs => (
                                                <div key={rs.id} className="space-y-1">
                                                  <p className="text-xs font-medium text-muted-foreground mt-2">{rs.name}</p>
                                                  <div className="flex flex-wrap gap-1">
                                                    {app.publisher && (
                                                      <Button variant="outline" size="sm" className="h-6 text-xs"
                                                        onClick={() => handleQuickAllow(app, rs.id, "publisher")} disabled={addRule.isPending}>
                                                        Publisher
                                                      </Button>
                                                    )}
                                                    <Button variant="outline" size="sm" className="h-6 text-xs"
                                                      onClick={() => handleQuickAllow(app, rs.id, "file_name")} disabled={addRule.isPending}>
                                                      File Name
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="h-6 text-xs"
                                                      onClick={() => handleQuickAllow(app, rs.id, "path")} disabled={addRule.isPending}>
                                                      Path
                                                    </Button>
                                                    {app.file_hash && (
                                                      <Button variant="outline" size="sm" className="h-6 text-xs"
                                                        onClick={() => handleQuickAllow(app, rs.id, "hash")} disabled={addRule.isPending}>
                                                        Hash
                                                      </Button>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    )}
                                    {ruleSets && ruleSets.length > 0 && (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive">
                                            <XCircle className="h-3 w-3 mr-1" />
                                            Block
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-64" align="end">
                                          <div className="space-y-3">
                                            <p className="text-sm font-medium">Block "{app.file_name}"</p>
                                            <div className="space-y-1">
                                              {ruleSets.map(rs => (
                                                <div key={rs.id} className="space-y-1">
                                                  <p className="text-xs font-medium text-muted-foreground mt-2">{rs.name}</p>
                                                  <div className="flex flex-wrap gap-1">
                                                    {app.publisher && (
                                                      <Button variant="outline" size="sm" className="h-6 text-xs"
                                                        onClick={() => handleQuickBlock(app, rs.id, "publisher")} disabled={addRule.isPending}>
                                                        Publisher
                                                      </Button>
                                                    )}
                                                    <Button variant="outline" size="sm" className="h-6 text-xs"
                                                      onClick={() => handleQuickBlock(app, rs.id, "file_name")} disabled={addRule.isPending}>
                                                      File Name
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="h-6 text-xs"
                                                      onClick={() => handleQuickBlock(app, rs.id, "path")} disabled={addRule.isPending}>
                                                      Path
                                                    </Button>
                                                    {app.file_hash && (
                                                      <Button variant="outline" size="sm" className="h-6 text-xs"
                                                        onClick={() => handleQuickBlock(app, rs.id, "hash")} disabled={addRule.isPending}>
                                                        Hash
                                                      </Button>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    )}
                                    {app.file_hash && (
                                      <Button variant="ghost" size="sm" className="h-7 text-xs"
                                        onClick={() => navigate(`/threat-hunting?search=${encodeURIComponent(app.file_hash!)}`)}>
                                        <Crosshair className="h-3 w-3 mr-1" />
                                        Hunt
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ============ RULE SETS TAB ============ */}
        <TabsContent value="rulesets" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage named collections of allow/block rules. Assign rule sets to endpoints or groups.
            </p>
            <Button onClick={handleCreateRuleSet}>
              <Plus className="h-4 w-4 mr-2" />
              Create Rule Set
            </Button>
          </div>

          {!ruleSets?.length ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium text-foreground mb-1">No Rule Sets</h3>
                <p className="text-sm text-muted-foreground mb-4">Create your first rule set to start managing application control</p>
                <Button onClick={handleCreateRuleSet}>
                  <Plus className="h-4 w-4 mr-2" />Create Rule Set
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ruleSets.map(rs => (
                <Card key={rs.id} className="cursor-pointer transition-all hover:border-primary/50" onClick={() => setSelectedRuleSetId(rs.id)}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                     <div className="space-y-1 flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{rs.name}</CardTitle>
                        <CardDescription className="line-clamp-2">{rs.description || "No description"}</CardDescription>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                        <Badge
                          variant={rs.mode === "enforced" ? "default" : "secondary"}
                          className={
                            rs.mode === "enforced"
                              ? "bg-destructive/10 text-destructive border-destructive/30"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                          }
                        >
                          {rs.mode === "enforced" ? (
                            <ShieldCheck className="h-3 w-3 mr-1" />
                          ) : (
                            <Eye className="h-3 w-3 mr-1" />
                          )}
                          {rs.mode === "enforced" ? "Enforced" : "Audit"}
                        </Badge>
                        <Badge variant="secondary">{rs.rule_count || 0} rules</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div onClick={(e) => e.stopPropagation()}>
                      <RuleSetAuditCountdown
                        ruleSetId={rs.id}
                        ruleSetName={rs.name}
                        auditWindowDays={rs.audit_window_days ?? 14}
                        autoPromote={rs.auto_promote ?? true}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Updated {format(new Date(rs.updated_at), "MMM d")}</span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => handleEditRuleSet(rs, e)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => handleDeleteRuleSet(rs.id, e)}><Trash2 className="h-4 w-4" /></Button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Rule Set Editor Dialog */}
      <Dialog open={showRuleSetEditor} onOpenChange={(open) => {
        setShowRuleSetEditor(open);
        if (!open) setSelectedTemplateId(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRuleSet ? "Edit Rule Set" : "Create Rule Set"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingRuleSet && (
              <div className="space-y-2">
                <Label>Start from template</Label>
                <Select
                  value={selectedTemplateId ?? "blank"}
                  onValueChange={(v) => setSelectedTemplateId(v === "blank" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Blank rule set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank rule set</SelectItem>
                    {(templates ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplateId && (
                  <p className="text-xs text-muted-foreground">
                    {(templates ?? []).find((t) => t.id === selectedTemplateId)?.description}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={ruleSetForm.name} onChange={(e) => setRuleSetForm({ ...ruleSetForm, name: e.target.value })} placeholder="e.g., SQL Server Allowlist" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={ruleSetForm.description} onChange={(e) => setRuleSetForm({ ...ruleSetForm, description: e.target.value })} placeholder="What applications does this rule set cover?" />
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={ruleSetForm.mode}
                onValueChange={(v: "audit" | "enforced") => setRuleSetForm({ ...ruleSetForm, mode: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="audit">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-amber-500" />
                      <span>Audit (Log Only)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="enforced">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-destructive" />
                      <span>Enforced (Block Unauthorized)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ruleSetForm.mode === "audit"
                  ? "Audit mode logs blocked applications without actually blocking them. Use this to discover and baseline applications."
                  : "Enforced mode actively blocks any application not in the allow list. Make sure you've reviewed all discovered apps first!"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleSetEditor(false)}>Cancel</Button>
            <Button onClick={handleSaveRuleSet} disabled={!ruleSetForm.name || createRuleSet.isPending || updateRuleSet.isPending}>
              {(createRuleSet.isPending || updateRuleSet.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingRuleSet ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
