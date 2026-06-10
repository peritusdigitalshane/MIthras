import { useState } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Users as UsersIcon,
  Plus,
  MoreHorizontal,
  Shield,
  UserCog,
  User,
  Trash2,
  Loader2,
  Crown,
  KeyRound,
} from "lucide-react";
import { ResetUserPasswordDialog } from "@/components/users/ResetUserPasswordDialog";
import { InviteUserDialog } from "@/components/users/InviteUserDialog";
import { Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { 
  useOrganizationMembers, 
  useAddMember, 
  useUpdateMemberRole, 
  useRemoveMember,
  useGrantSuperAdmin,
  useRevokeSuperAdmin,
  OrgRole 
} from "@/hooks/useUsers";

const roleConfig: Record<OrgRole, { label: string; icon: React.ElementType; color: string }> = {
  owner: { label: "Owner", icon: Shield, color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  admin: { label: "Admin", icon: UserCog, color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  member: { label: "Member", icon: User, color: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
};

const Users = () => {
  const { currentOrganization, isImpersonating, isLoading: tenantLoading, isSuperAdmin } = useTenant();
  const { user } = useAuth();
  const { data: members = [], isLoading } = useOrganizationMembers();
  const addMember = useAddMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const grantSuperAdmin = useGrantSuperAdmin();
  const revokeSuperAdmin = useRevokeSuperAdmin();
  const { toast } = useToast();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<OrgRole>("member");
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; email: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<{ userId: string; email: string } | null>(null);

  const handleAddMember = async () => {
    if (!newEmail.trim()) {
      toast({
        title: "Email required",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    try {
      await addMember.mutateAsync({ email: newEmail.trim(), role: newRole });
      toast({
        title: "Member added",
        description: `${newEmail} has been added to the organization.`,
      });
      setAddDialogOpen(false);
      setNewEmail("");
      setNewRole("member");
    } catch (error: any) {
      toast({
        title: "Failed to add member",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: OrgRole, email: string) => {
    try {
      await updateRole.mutateAsync({ membershipId, newRole });
      toast({
        title: "Role updated",
        description: `${email}'s role has been changed to ${roleConfig[newRole].label}.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to update role",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;

    try {
      await removeMember.mutateAsync({ membershipId: memberToRemove.id, email: memberToRemove.email });
      toast({
        title: "Member removed",
        description: `${memberToRemove.email} has been removed from the organization.`,
      });
      setMemberToRemove(null);
    } catch (error: any) {
      toast({
        title: "Failed to remove member",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleSuperAdmin = async (userId: string, currentlySuper: boolean, email: string) => {
    try {
      if (currentlySuper) {
        await revokeSuperAdmin.mutateAsync({ userId, email });
        toast({
          title: "Super Admin revoked",
          description: `${email} is no longer a Super Admin.`,
        });
      } else {
        await grantSuperAdmin.mutateAsync({ userId, email });
        toast({
          title: "Super Admin granted",
          description: `${email} is now a Super Admin.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Failed to update Super Admin status",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (tenantLoading || isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">User Management</h1>
            <p className="text-muted-foreground">
              Manage users and roles for {currentOrganization?.name || "your organization"}
              {isImpersonating && (
                <Badge variant="outline" className="ml-2 border-amber-500/30 text-amber-600">
                  Viewing as tenant
                </Badge>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setInviteDialogOpen(true)}>
              <Mail className="mr-2 h-4 w-4" />
              Invite user
            </Button>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add existing user
            </Button>
          </div>
        </div>

        <InviteUserDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <UsersIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">{members.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <UserCog className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-2xl font-bold">
                  {members.filter((m) => m.role === "admin" || m.role === "owner").length}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/10">
                <User className="h-5 w-5 text-slate-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Members</p>
                <p className="text-2xl font-bold">
                  {members.filter((m) => m.role === "member").length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const role = roleConfig[member.role];
                const RoleIcon = role.icon;
                const isCurrentUser = member.user_id === user?.id;
                const isOwner = member.role === "owner";

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                          {(member.profile?.display_name || member.profile?.email || "?")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <span className="font-medium">
                          {member.profile?.display_name || "Unknown"}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.profile?.email || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={role.color}>
                          <RoleIcon className="h-3 w-3 mr-1" />
                          {role.label}
                        </Badge>
                        {member.is_super_admin && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">
                            <Crown className="h-3 w-3 mr-1" />
                            Super Admin
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(member.created_at), "d MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Member options" disabled={isOwner && !isCurrentUser}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleRoleChange(member.id, "admin", member.profile?.email || "")}
                            disabled={member.role === "admin" || isOwner}
                          >
                            <UserCog className="h-4 w-4 mr-2" />
                            Make Admin
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRoleChange(member.id, "member", member.profile?.email || "")}
                            disabled={member.role === "member" || isOwner}
                          >
                            <User className="h-4 w-4 mr-2" />
                            Make Member
                          </DropdownMenuItem>
                          {isSuperAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleToggleSuperAdmin(member.user_id, member.is_super_admin, member.profile?.email || "")}
                                disabled={isCurrentUser}
                              >
                                <Crown className="h-4 w-4 mr-2" />
                                {member.is_super_admin ? "Revoke Super Admin" : "Grant Super Admin"}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setResetTarget({ userId: member.user_id, email: member.profile?.email || "" })}
                            disabled={!member.profile?.email}
                          >
                            <KeyRound className="h-4 w-4 mr-2" />
                            Reset password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setMemberToRemove({ id: member.id, email: member.profile?.email || "" })}
                            disabled={isOwner || isCurrentUser}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Add User Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
              <DialogDescription>
                Add an existing user to {currentOrganization?.name}. The user must have already signed up.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={newRole} onValueChange={(val) => setNewRole(val as OrgRole)}>
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
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddMember} disabled={addMember.isPending}>
                {addMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove Confirmation Dialog */}
        <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove {memberToRemove?.email} from this organization?
                They will lose access to all organization resources.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRemoveMember}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {resetTarget && (
          <ResetUserPasswordDialog
            open={!!resetTarget}
            onOpenChange={(o) => { if (!o) setResetTarget(null); }}
            targetUserId={resetTarget.userId}
            targetEmail={resetTarget.email}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default Users;
