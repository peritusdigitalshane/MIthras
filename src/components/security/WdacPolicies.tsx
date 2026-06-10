import { useState } from "react";
import { format } from "date-fns";
import { useWdacPolicies, useWdacMutations, WdacPolicy } from "@/hooks/useWdac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Eye, ShieldCheck, Trash2, Edit, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WdacPoliciesProps {
  onSelectPolicy: (id: string | null) => void;
  selectedPolicyId: string | null;
}

export function WdacPolicies({ onSelectPolicy, selectedPolicyId }: WdacPoliciesProps) {
  const { data: policies, isLoading } = useWdacPolicies();
  const { createPolicy, updatePolicy, deletePolicy } = useWdacMutations();
  const [showEditor, setShowEditor] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<WdacPolicy | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    mode: "audit" as "audit" | "enforced",
  });

  const handleCreate = () => {
    setEditingPolicy(null);
    setFormData({ name: "", description: "", mode: "audit" });
    setShowEditor(true);
  };

  const handleEdit = (policy: WdacPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      description: policy.description || "",
      mode: policy.mode,
    });
    setShowEditor(true);
  };

  const handleSave = () => {
    if (editingPolicy) {
      updatePolicy.mutate({ id: editingPolicy.id, ...formData });
    } else {
      createPolicy.mutate(formData);
    }
    setShowEditor(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this policy?")) {
      deletePolicy.mutate(id);
      if (selectedPolicyId === id) {
        onSelectPolicy(null);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">WDAC Policies</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage application control policies. Monitor mode logs blocked apps, Enforce mode blocks them.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Policy
        </Button>
      </div>

      {/* Policy Grid */}
      {!policies?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-foreground mb-1">No WDAC Policies</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first policy to start monitoring application usage
            </p>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Policy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {policies.map((policy) => (
            <Card
              key={policy.id}
              className={cn(
                "cursor-pointer transition-all hover:border-primary/50",
                selectedPolicyId === policy.id && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => onSelectPolicy(policy.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{policy.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {policy.description || "No description"}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={policy.mode === "enforced" ? "default" : "secondary"}
                    className={cn(
                      policy.mode === "enforced" 
                        ? "bg-red-500/10 text-red-600 border-red-500/30" 
                        : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                    )}
                  >
                    {policy.mode === "enforced" ? (
                      <ShieldCheck className="h-3 w-3 mr-1" />
                    ) : (
                      <Eye className="h-3 w-3 mr-1" />
                    )}
                    {policy.mode === "enforced" ? "Enforced" : "Monitor"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Created {format(new Date(policy.created_at), "d MMM yyyy")}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(policy);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(policy.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Policy Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPolicy ? "Edit Policy" : "Create WDAC Policy"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Policy Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Production Servers"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the purpose of this policy..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <Select
                value={formData.mode}
                onValueChange={(value: "audit" | "enforced") => setFormData({ ...formData, mode: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="audit">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-amber-500" />
                      <span>Monitor (Audit Only)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="enforced">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-red-500" />
                      <span>Enforced (Block Unauthorized)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.mode === "audit"
                  ? "Monitor mode logs blocked applications without actually blocking them. Use this to discover applications in use."
                  : "Enforced mode actively blocks any application not in the allow list. Make sure you've reviewed all discovered apps first!"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.name || createPolicy.isPending || updatePolicy.isPending}
            >
              {(createPolicy.isPending || updatePolicy.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingPolicy ? "Save Changes" : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
