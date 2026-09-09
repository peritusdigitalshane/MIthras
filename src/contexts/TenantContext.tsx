import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface Organization {
  id: string;
  name: string;
  slug: string;
  organization_type: "partner" | "customer" | "distributor" | "home_user";
  parent_partner_id: string | null;
  network_module_enabled: boolean;
  router_module_enabled: boolean;
  legacy_hardening_enabled: boolean;
  timezone: string;
}

// localStorage key for the currently-impersonated org id. Keyed by user id so
// switching accounts in the same browser doesn't accidentally restore the
// previous operator's pivot. Survives OAuth redirects (e.g. Connect M365).
const IMPERSONATION_KEY_PREFIX = "mithras.impersonated-org:";
const impersonationKey = (userId: string) => `${IMPERSONATION_KEY_PREFIX}${userId}`;

interface TenantContextType {
  // The user's own organization
  userOrganization: Organization | null;
  // The currently active organization (might be impersonated)
  currentOrganization: Organization | null;
  // Whether the user is a super admin
  isSuperAdmin: boolean;
  // Whether the user is a partner admin
  isPartnerAdmin: boolean;
  // True when the current user is owner/admin of their userOrganization.
  // Used to gate destructive actions (queue agent command, etc.) at the UI
  // layer so members see a disabled button rather than an RPC rejection.
  isOrgAdmin: boolean;
  // Whether we're currently impersonating another tenant
  isImpersonating: boolean;
  // All organizations (only available for super admins)
  allOrganizations: Organization[];
  // Partner's customer organizations (for partner admins)
  partnerCustomers: Organization[];
  // Set the impersonated organization (null to stop impersonating)
  setImpersonatedOrg: (org: Organization | null) => void;
  // Loading state
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  userOrganization: null,
  currentOrganization: null,
  isSuperAdmin: false,
  isPartnerAdmin: false,
  isOrgAdmin:     false,
  isImpersonating: false,
  allOrganizations: [],
  partnerCustomers: [],
  setImpersonatedOrg: () => {},
  isLoading: true,
});

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
};

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const { user, isLoading: authLoading } = useAuth();
  const [userOrganization, setUserOrganization] = useState<Organization | null>(null);
  const [impersonatedOrg, setImpersonatedOrgState] = useState<Organization | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isPartnerAdmin, setIsPartnerAdmin] = useState(false);
  const [userOrgRole, setUserOrgRole] = useState<string | null>(null);
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [partnerCustomers, setPartnerCustomers] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTenantData = async () => {
      if (!user) {
        setUserOrganization(null);
        setIsSuperAdmin(false);
        setIsPartnerAdmin(false);
        setAllOrganizations([]);
        setPartnerCustomers([]);
        setImpersonatedOrgState(null);
        // Don't sweep every persisted pivot — only clear keys for the user
        // we knew about. (No-op when no prior session existed.)
        setIsLoading(false);
        return;
      }

      try {
        // Check super admin status via SECURITY DEFINER function (avoids RLS edge cases)
        const { data: isAdminData, error: isAdminError } = await supabase.rpc(
          "is_super_admin",
          { _user_id: user.id }
        );
        if (isAdminError) throw isAdminError;

        const isAdmin = !!isAdminData;
        setIsSuperAdmin(isAdmin);

        // Check partner admin status
        const { data: isPartnerData, error: isPartnerError } = await supabase.rpc(
          "is_partner_admin",
          { _user_id: user.id }
        );
        if (isPartnerError) throw isPartnerError;

        const isPartner = !!isPartnerData;
        setIsPartnerAdmin(isPartner);

        // Get user's organization (and role within it). Role tells us
        // whether the user is owner/admin (can run destructive actions)
        // vs member/viewer (read-only).
        const { data: membershipData, error: membershipError } = await supabase
          .from("organization_memberships")
          .select("organization_id, role")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        if (membershipError) {
          // Don't block super admin functionality if membership lookup fails
          console.warn("Failed to load user organization membership:", membershipError);
        }

        if (membershipData) {
          setUserOrgRole((membershipData as any).role ?? null);
          const { data: orgData } = await supabase
            .from("organizations")
            .select("id, name, slug, organization_type, parent_partner_id, network_module_enabled, router_module_enabled, legacy_hardening_enabled, timezone")
            .eq("id", membershipData.organization_id)
            .single();

          if (orgData) {
            setUserOrganization(orgData as Organization);
          }
        }

        // If super admin, fetch all organizations
        let loadedAllOrgs: Organization[] = [];
        if (isAdmin) {
          const { data: allOrgs, error: orgsError } = await supabase
            .from("organizations")
            .select("id, name, slug, organization_type, parent_partner_id, network_module_enabled, router_module_enabled, legacy_hardening_enabled, timezone")
            .order("name");

          if (orgsError) throw orgsError;

          loadedAllOrgs = (allOrgs || []) as Organization[];
          setAllOrganizations(loadedAllOrgs);
        }

        // If partner admin, fetch their customer organizations
        let loadedPartnerCustomers: Organization[] = [];
        if (isPartner && !isAdmin) {
          const { data: customerOrgs, error: customerError } = await supabase
            .rpc("get_partner_customer_org_ids", { _user_id: user.id });

          if (customerError) throw customerError;

          if (customerOrgs && customerOrgs.length > 0) {
            const { data: customers } = await supabase
              .from("organizations")
              .select("id, name, slug, organization_type, parent_partner_id, network_module_enabled, router_module_enabled, legacy_hardening_enabled, timezone")
              .in("id", customerOrgs)
              .order("name");

            loadedPartnerCustomers = (customers || []) as Organization[];
            setPartnerCustomers(loadedPartnerCustomers);
          }
        }

        // Restore the impersonated org if one was pinned before a page reload
        // (e.g. the partner was pivoted into a customer, clicked Connect M365,
        // and OAuth redirected the SPA away and back). Only restore if the
        // user still has access to that org — otherwise drop the key.
        try {
          const persistedId = localStorage.getItem(impersonationKey(user.id));
          if (persistedId) {
            const candidate =
              loadedAllOrgs.find(o => o.id === persistedId) ??
              loadedPartnerCustomers.find(o => o.id === persistedId) ??
              null;
            if (candidate && (isAdmin || isPartner)) {
              setImpersonatedOrgState(candidate);
            } else {
              localStorage.removeItem(impersonationKey(user.id));
            }
          }
        } catch { /* localStorage unavailable — silent fallback */ }
      } catch (error) {
        console.error("Error loading tenant data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (!authLoading) {
      loadTenantData();
    }
  }, [user, authLoading]);

  const setImpersonatedOrg = (org: Organization | null) => {
    if (!isSuperAdmin && !isPartnerAdmin && org !== null) {
      console.warn("Only super admins or partner admins can impersonate organizations");
      return;
    }
    const previous = impersonatedOrg;
    setImpersonatedOrgState(org);
    // Persist for survive-a-reload (OAuth round-trips, hard refresh).
    try {
      if (user?.id) {
        if (org) localStorage.setItem(impersonationKey(user.id), org.id);
        else localStorage.removeItem(impersonationKey(user.id));
      }
    } catch { /* localStorage unavailable */ }
    // Audit trail: super-admin / partner pivots into / out of a customer tenant
    // are recorded on BOTH the source and target orgs so each side has visibility
    // of operator activity. Best-effort — never blocks the UI state change.
    void (async () => {
      try {
        if (org && org.id !== previous?.id) {
          const { error } = await supabase.rpc("log_activity", {
            _org_id: org.id,
            _action: "impersonation_start",
            _resource_type: "organization",
            _resource_id: org.id,
            _details: { actor_role: isSuperAdmin ? "super_admin" : "partner_admin", target_org_name: org.name },
          });
          if (error) console.error("impersonation_start audit failed", error);
        } else if (!org && previous) {
          const { error } = await supabase.rpc("log_activity", {
            _org_id: previous.id,
            _action: "impersonation_end",
            _resource_type: "organization",
            _resource_id: previous.id,
            _details: { actor_role: isSuperAdmin ? "super_admin" : "partner_admin", target_org_name: previous.name },
          });
          if (error) console.error("impersonation_end audit failed", error);
        }
      } catch (e) {
        console.error("impersonation audit log threw", e);
      }
    })();
  };

  const currentOrganization = impersonatedOrg || userOrganization;
  const isImpersonating = impersonatedOrg !== null;
  // Super-admins always have admin powers everywhere. Partner admins +
  // impersonating super-admins act as admin of the org they're viewing.
  // Otherwise: own-org membership role must be owner or admin.
  const isOrgAdmin = isSuperAdmin || isPartnerAdmin || (userOrgRole === "owner" || userOrgRole === "admin");

  return (
    <TenantContext.Provider
      value={{
        userOrganization,
        currentOrganization,
        isSuperAdmin,
        isPartnerAdmin,
        isOrgAdmin,
        isImpersonating,
        allOrganizations,
        partnerCustomers,
        setImpersonatedOrg,
        isLoading,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};
