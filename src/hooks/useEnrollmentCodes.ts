import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface EnrollmentCode {
  id: string;
  code: string;
  organization_id: string;
  role: "owner" | "admin" | "member";
  is_single_use: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
}

export interface CodeValidationResult {
  organization_id: string | null;
  organization_name: string | null;
  role: "owner" | "admin" | "member" | null;
  is_valid: boolean;
  error_message: string | null;
}

export function useEnrollmentCodes(orgId?: string) {
  const { currentOrganization, isSuperAdmin } = useTenant();
  const targetOrgId = orgId || currentOrganization?.id;

  return useQuery({
    queryKey: ["enrollment-codes", targetOrgId],
    enabled: !!targetOrgId,
    queryFn: async () => {
      let query = supabase
        .from("enrollment_codes")
        .select("*")
        .order("created_at", { ascending: false });

      // If not super admin, filter by org
      if (!isSuperAdmin && targetOrgId) {
        query = query.eq("organization_id", targetOrgId);
      } else if (isSuperAdmin && targetOrgId) {
        query = query.eq("organization_id", targetOrgId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EnrollmentCode[];
    },
  });
}

export function useCreateEnrollmentCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      organizationId,
      role,
      isSingleUse,
      maxUses,
      expiresAt,
    }: {
      organizationId: string;
      role: "owner" | "admin" | "member";
      isSingleUse: boolean;
      maxUses?: number | null;
      expiresAt?: string | null;
    }) => {
      // Generate a random code
      const code = generateCode();

      const { data, error } = await supabase
        .from("enrollment_codes")
        .insert({
          code,
          organization_id: organizationId,
          role,
          is_single_use: isSingleUse,
          max_uses: isSingleUse ? 1 : maxUses,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (error) throw error;
      
      // Log activity
      await logActivity(organizationId, "create", "enrollment_code", data.id, { 
        code: data.code, 
        role,
        isSingleUse 
      });
      
      return data as EnrollmentCode;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrollment-codes"] });
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useDeactivateEnrollmentCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ codeId }: { codeId: string }) => {
      const { error } = await supabase
        .from("enrollment_codes")
        .update({ is_active: false })
        .eq("id", codeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrollment-codes"] });
    },
  });
}

// ---- Pending enrolment invites ------------------------------------------
// "Pending" = an org the caller created (as parent), with an active enrolment
// code that nobody has signed up against yet. The disty uses this on
// /distributor/resellers to find resellers they invited but haven't joined;
// the partner uses it on /my-customers for the same on customers.

export interface PendingEnrolmentInvite {
  org_id:           string;
  org_name:         string;
  org_slug:         string;
  org_type:         string;
  org_created_at:   string;
  code_id:          string;
  code:             string;
  code_role:        "owner" | "admin" | "member";
  code_created_at:  string;
  code_expires_at:  string | null;
  code_use_count:   number;
  code_max_uses:    number | null;
  code_is_active:   boolean;
}

export function usePendingEnrolmentInvites(parentOrgId: string | null | undefined, childOrgType?: "partner" | "customer") {
  return useQuery({
    queryKey: ["pending-invites", parentOrgId, childOrgType ?? null],
    enabled: !!parentOrgId,
    queryFn: async () => {
      if (!parentOrgId) return [];
      const { data, error } = await supabase.rpc("get_pending_enrolment_invites" as any, {
        _parent_org_id:  parentOrgId,
        _child_org_type: childOrgType ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PendingEnrolmentInvite[];
    },
    staleTime: 30_000,
  });
}

export function useValidateEnrollmentCode() {
  return useMutation({
    mutationFn: async (code: string): Promise<CodeValidationResult> => {
      const { data, error } = await supabase.rpc("validate_enrollment_code", {
        _code: code,
      });

      if (error) throw error;
      
      // The function returns an array with one row
      const result = data?.[0];
      if (!result) {
        return {
          organization_id: null,
          organization_name: null,
          role: null,
          is_valid: false,
          error_message: "Invalid enrollment code",
        };
      }

      return result as CodeValidationResult;
    },
  });
}

// Generate a 12-character enrolment code (excludes 0/O/1/I for readability).
//
// CSPRNG via crypto.getRandomValues, NOT Math.random — these codes grant
// admin-level access to whichever org they're attached to, so predictability
// would be an auth-bypass class bug. 12 chars × 32-char alphabet ≈ 60 bits
// of entropy.
//
// Ideally the value would be generated server-side (Postgres default on the
// `code` column) so a compromised browser couldn't influence it; left as a
// follow-up because it requires schema + insert-path changes.
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += chars.charAt(b % chars.length);
  return code;
}