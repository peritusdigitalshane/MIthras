import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { 
  Ticket, 
  Plus, 
  Copy, 
  XCircle,
  Loader2,
  CheckCircle,
  Clock,
  Users,
  User,
  UserCog,
  Shield,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useEnrollmentCodes, 
  useCreateEnrollmentCode, 
  useDeactivateEnrollmentCode,
  EnrollmentCode 
} from "@/hooks/useEnrollmentCodes";

interface EnrollmentCodesSectionProps {
  organizationId: string;
  organizationName: string;
}

const roleConfig = {
  owner: { label: "Owner", icon: Shield, color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  admin: { label: "Admin", icon: UserCog, color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  member: { label: "Member", icon: User, color: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
};

export function EnrollmentCodesSection({ organizationId, organizationName }: EnrollmentCodesSectionProps) {
  const { data: codes = [], isLoading } = useEnrollmentCodes(organizationId);
  const createCode = useCreateEnrollmentCode();
  const deactivateCode = useDeactivateEnrollmentCode();
  const { toast } = useToast();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState<"owner" | "admin" | "member">("member");
  const [isSingleUse, setIsSingleUse] = useState(true);
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const handleCreateCode = async () => {
    try {
      const expiresAt = expiresInDays 
        ? new Date(Date.now() + parseInt(expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const result = await createCode.mutateAsync({
        organizationId,
        role: newRole,
        isSingleUse,
        maxUses: isSingleUse ? null : (maxUses ? parseInt(maxUses) : null),
        expiresAt,
      });

      setCreatedCode(result.code);
      toast({
        title: "Enrollment code created",
        description: "Copy the code to share with the user.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to create code",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied!",
      description: "Enrollment code copied to clipboard.",
    });
  };

  const handleDeactivate = async (codeId: string) => {
    try {
      await deactivateCode.mutateAsync({ codeId });
      toast({
        title: "Code deactivated",
        description: "The enrollment code has been deactivated.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to deactivate",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setNewRole("member");
    setIsSingleUse(true);
    setMaxUses("");
    setExpiresInDays("");
    setCreatedCode(null);
  };

  const getCodeStatus = (code: EnrollmentCode) => {
    if (!code.is_active) return { label: "Inactive", color: "bg-gray-500/10 text-gray-500 border-gray-500/30" };
    if (code.expires_at && new Date(code.expires_at) < new Date()) {
      return { label: "Expired", color: "bg-red-500/10 text-red-500 border-red-500/30" };
    }
    if (code.is_single_use && code.use_count > 0) {
      return { label: "Used", color: "bg-gray-500/10 text-gray-500 border-gray-500/30" };
    }
    if (code.max_uses && code.use_count >= code.max_uses) {
      return { label: "Limit reached", color: "bg-gray-500/10 text-gray-500 border-gray-500/30" };
    }
    return { label: "Active", color: "bg-green-500/10 text-green-500 border-green-500/30" };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Enrollment Codes</h3>
          <span className="text-sm text-muted-foreground">for {organizationName}</span>
        </div>
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Code
        </Button>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Uses</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.map((code) => {
              const status = getCodeStatus(code);
              const role = roleConfig[code.role];
              const RoleIcon = role.icon;

              return (
                <TableRow key={code.id}>
                  <TableCell>
                    <code className="bg-muted px-2 py-1 rounded font-mono text-sm">
                      {code.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={role.color}>
                      <RoleIcon className="h-3 w-3 mr-1" />
                      {role.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      {code.is_single_use ? (
                        <>
                          <User className="h-3 w-3" />
                          Single-use
                        </>
                      ) : (
                        <>
                          <Users className="h-3 w-3" />
                          Multi-use
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {code.max_uses 
                      ? `${code.use_count}/${code.max_uses}`
                      : code.is_single_use 
                        ? `${code.use_count}/1`
                        : code.use_count
                    }
                  </TableCell>
                  <TableCell>
                    {code.expires_at ? (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {format(new Date(code.expires_at), "d MMM yyyy")}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={status.color}>
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopyCode(code.code)}
                        title="Copy code"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {code.is_active && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeactivate(code.id)}
                          title="Deactivate"
                        >
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {codes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No enrollment codes yet. Create one to invite users.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Code Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => {
        setCreateDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createdCode ? "Enrollment Code Created" : "Create Enrollment Code"}
            </DialogTitle>
            <DialogDescription>
              {createdCode 
                ? "Share this code with the user to enroll them."
                : `Create a code for users to join ${organizationName}.`
              }
            </DialogDescription>
          </DialogHeader>

          {createdCode ? (
            <div className="py-6">
              <div className="flex items-center justify-center gap-3">
                <code className="text-2xl font-mono font-bold bg-muted px-4 py-2 rounded-lg">
                  {createdCode}
                </code>
                <Button variant="outline" size="icon" onClick={() => handleCopyCode(createdCode)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 mt-4 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                Code created successfully
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Role for new user</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Member - Can view and use the platform
                      </div>
                    </SelectItem>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4" />
                        Admin - Can manage settings and users
                      </div>
                    </SelectItem>
                    <SelectItem value="owner">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Owner - Full control of the organization
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Single-use code</Label>
                  <p className="text-xs text-muted-foreground">
                    Code can only be used once
                  </p>
                </div>
                <Switch checked={isSingleUse} onCheckedChange={setIsSingleUse} />
              </div>

              {!isSingleUse && (
                <div className="space-y-2">
                  <Label htmlFor="max-uses">Maximum uses (optional)</Label>
                  <Input
                    id="max-uses"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="expires">Expires in (days, optional)</Label>
                <Input
                  id="expires"
                  type="number"
                  min="1"
                  placeholder="Never expires"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {createdCode ? (
              <Button onClick={() => {
                setCreateDialogOpen(false);
                resetForm();
              }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCode} disabled={createCode.isPending}>
                  {createCode.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Code
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}