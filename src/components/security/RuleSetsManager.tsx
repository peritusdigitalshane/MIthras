import { useState } from "react";
import { useRuleSets, useRuleSetRules, useRuleSetMutations, RuleSet, RuleSetRule } from "@/hooks/useRuleSets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { 
  Plus, 
  Trash2, 
  Edit, 
  Loader2, 
  Layers,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowLeft
} from "lucide-react";
import { format } from "date-fns";

interface RuleSetsManagerProps {
  onSelectRuleSet?: (id: string | null) => void;
  selectedRuleSetId?: string | null;
}

export function RuleSetsManager({ onSelectRuleSet, selectedRuleSetId }: RuleSetsManagerProps) {
  const { data: ruleSets, isLoading } = useRuleSets();
  const { data: rules, isLoading: rulesLoading } = useRuleSetRules(selectedRuleSetId || null);
  const { createRuleSet, updateRuleSet, deleteRuleSet, addRule, deleteRule } = useRuleSetMutations();
  
  const [showEditor, setShowEditor] = useState(false);
  const [editingRuleSet, setEditingRuleSet] = useState<RuleSet | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleFormData, setRuleFormData] = useState({
    rule_type: "publisher" as RuleSetRule["rule_type"],
    action: "allow" as RuleSetRule["action"],
    value: "",
    publisher_name: "",
    product_name: "",
    description: "",
  });

  const selectedRuleSet = ruleSets?.find(rs => rs.id === selectedRuleSetId);

  const handleCreate = () => {
    setEditingRuleSet(null);
    setFormData({ name: "", description: "" });
    setShowEditor(true);
  };

  const handleEdit = (rs: RuleSet, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRuleSet(rs);
    setFormData({ name: rs.name, description: rs.description || "" });
    setShowEditor(true);
  };

  const handleSave = () => {
    if (editingRuleSet) {
      updateRuleSet.mutate({ id: editingRuleSet.id, ...formData });
    } else {
      createRuleSet.mutate(formData);
    }
    setShowEditor(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this rule set? All rules within it will also be deleted.")) {
      deleteRuleSet.mutate(id);
      if (selectedRuleSetId === id) {
        onSelectRuleSet?.(null);
      }
    }
  };

  const handleAddRule = () => {
    if (!selectedRuleSetId || !ruleFormData.value) return;
    
    addRule.mutate({
      rule_set_id: selectedRuleSetId,
      ...ruleFormData,
      file_version_min: null,
    });
    
    setShowAddRule(false);
    setRuleFormData({
      rule_type: "publisher",
      action: "allow",
      value: "",
      publisher_name: "",
      product_name: "",
      description: "",
    });
  };

  const handleDeleteRule = (rule: RuleSetRule) => {
    if (confirm("Delete this rule?")) {
      deleteRule.mutate({ id: rule.id, ruleSetId: rule.rule_set_id });
    }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Detail view when a rule set is selected
  if (selectedRuleSetId && selectedRuleSet) {
    const allowRules = rules?.filter((r) => r.action === "allow") || [];
    const blockRules = rules?.filter((r) => r.action === "block") || [];

    return (
      <div className="space-y-6">
        {/* Back & Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => onSelectRuleSet?.(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-lg font-semibold">{selectedRuleSet.name}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedRuleSet.description || "No description"} • {rules?.length || 0} rules
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
            {/* Allow Rules */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Allow Rules ({allowRules.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!allowRules.length ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No allow rules. Applications matching allow rules will be permitted.
                  </p>
                ) : (
                  <ScrollArea className="h-[200px]">
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
                        {allowRules.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell>
                              <Badge variant="secondary">{getRuleTypeLabel(rule.rule_type)}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm max-w-[300px] truncate">
                              {rule.value}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {rule.description || "-"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteRule(rule)}
                              >
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

            {/* Block Rules */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Block Rules ({blockRules.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!blockRules.length ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No block rules. Applications matching block rules will be denied.
                  </p>
                ) : (
                  <ScrollArea className="h-[200px]">
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
                        {blockRules.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell>
                              <Badge variant="secondary">{getRuleTypeLabel(rule.rule_type)}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm max-w-[300px] truncate">
                              {rule.value}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {rule.description || "-"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteRule(rule)}
                              >
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

        {/* Add Rule Dialog */}
        <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Rule to "{selectedRuleSet.name}"</DialogTitle>
              <DialogDescription>
                Create a new allow or block rule for this rule set.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select
                    value={ruleFormData.action}
                    onValueChange={(v: "allow" | "block") => setRuleFormData({ ...ruleFormData, action: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span>Allow</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="block">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-500" />
                          <span>Block</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rule Type</Label>
                  <Select
                    value={ruleFormData.rule_type}
                    onValueChange={(v: RuleSetRule["rule_type"]) => setRuleFormData({ ...ruleFormData, rule_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                <Label htmlFor="value">Value *</Label>
                <Input
                  id="value"
                  value={ruleFormData.value}
                  onChange={(e) => setRuleFormData({ ...ruleFormData, value: e.target.value })}
                  placeholder={
                    ruleFormData.rule_type === "publisher" ? "O=Microsoft Corporation, L=Redmond..." :
                    ruleFormData.rule_type === "path" ? "C:\\Program Files\\*" :
                    ruleFormData.rule_type === "hash" ? "SHA256 hash..." :
                    "notepad.exe"
                  }
                />
              </div>
              {ruleFormData.rule_type === "publisher" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="publisher">Publisher Name</Label>
                    <Input
                      id="publisher"
                      value={ruleFormData.publisher_name}
                      onChange={(e) => setRuleFormData({ ...ruleFormData, publisher_name: e.target.value })}
                      placeholder="Microsoft Corporation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product">Product Name</Label>
                    <Input
                      id="product"
                      value={ruleFormData.product_name}
                      onChange={(e) => setRuleFormData({ ...ruleFormData, product_name: e.target.value })}
                      placeholder="Windows"
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={ruleFormData.description}
                  onChange={(e) => setRuleFormData({ ...ruleFormData, description: e.target.value })}
                  placeholder="Why this rule exists..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddRule(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddRule} disabled={!ruleFormData.value || addRule.isPending}>
                {addRule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Rule Sets</h2>
          <p className="text-sm text-muted-foreground">
            Create named collections of allow/block rules. Assign rule sets to endpoints or groups.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Rule Set
        </Button>
      </div>

      {/* Rule Sets Grid */}
      {!ruleSets?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-foreground mb-1">No Rule Sets</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first rule set to organize application control rules
            </p>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Rule Set
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ruleSets.map((rs) => (
            <Card
              key={rs.id}
              className="cursor-pointer transition-all hover:border-primary/50"
              onClick={() => onSelectRuleSet?.(rs.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{rs.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {rs.description || "No description"}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0">
                    {rs.rule_count || 0} rules
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Updated {format(new Date(rs.updated_at), "MMM d")}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => handleEdit(rs, e)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(rs.id, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Rule Set Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRuleSet ? "Edit Rule Set" : "Create Rule Set"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., SQL Server Allowlist"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What applications does this rule set cover?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.name || createRuleSet.isPending || updateRuleSet.isPending}
            >
              {(createRuleSet.isPending || updateRuleSet.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingRuleSet ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
