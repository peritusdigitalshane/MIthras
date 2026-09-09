import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { logActivity } from "@/hooks/useActivityLogs";

export type OrgRole = "owner" | "admin" | "member";

export interface OrganizationMember {
  id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  is_super_admin: boolean;
  profile: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export function useOrganizationMembers() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["organization-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      // Fetch memberships
      const { data: memberships, error: membershipsError } = await supabase
        .from("organization_memberships")
        .select("id, user_id, role, created_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });

      if (membershipsError) throw membershipsError;
      if (!memberships || memberships.length === 0) return [];

      // Fetch profiles for all user_ids
      const userIds = memberships.map((m) => m.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, display_name, avatar_url")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Fetch super admin status for all users
      const { data: superAdmins } = await supabase
        .from("super_admins")
        .select("user_id")
        .in("user_id", userIds);

      const superAdminSet = new Set((superAdmins || []).map((sa) => sa.user_id));

      // Map profiles by id for quick lookup
      const profileMap = new Map(
        (profiles || []).map((p) => [p.id, p])
      );

      return memberships.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        role: item.role as OrgRole,
        created_at: item.created_at,
        is_super_admin: superAdminSet.has(item.user_id),
        profile: profileMap.get(item.user_id) || null,
      })) as OrganizationMember[];
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      membershipId,
      newRole,
    }: {
      membershipId: string;
      newRole: OrgRole;
    }) => {
      const { error } = await supabase
        .from("organization_memberships")
        .update({ role: newRole })
        .eq("id", membershipId);

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "update", "user", membershipId, { newRole });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ membershipId, email }: { membershipId: string; email?: string }) => {
      const { error } = await supabase
        .from("organization_memberships")
        .delete()
        .eq("id", membershipId);

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "user", membershipId, { email });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({
      email,
      role,
    }: {
      email: string;
      role: OrgRole;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");

      // First, find the user by email in profiles
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profile) {
        throw new Error(`No user found with email: ${email}. The user must sign up first.`);
      }

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .eq("user_id", profile.id)
        .maybeSingle();

      if (existing) {
        throw new Error("This user is already a member of this organization.");
      }

      // Add the membership
      const { error: insertError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: currentOrganization.id,
          user_id: profile.id,
          role,
        });

      if (insertError) throw insertError;

      // Log activity
      await logActivity(currentOrganization.id, "create", "user", profile.id, { 
        email: profile.email, 
        role 
      });

      return { userId: profile.id, email: profile.email };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useGrantSuperAdmin() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ userId, email }: { userId: string; email?: string }) => {
      const { error } = await supabase
        .from("super_admins")
        .insert({ user_id: userId });

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "create", "super_admin", userId, { email });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useRevokeSuperAdmin() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async ({ userId, email }: { userId: string; email?: string }) => {
      const { error } = await supabase
        .from("super_admins")
        .delete()
        .eq("user_id", userId);

      if (error) throw error;
      
      // Log activity
      if (currentOrganization?.id) {
        await logActivity(currentOrganization.id, "delete", "super_admin", userId, { email });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}
