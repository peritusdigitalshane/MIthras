import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ShieldOverview {
    enabled: boolean;
    enabled_at: string | null;
    active_elevations: number;
    pending_elevations: number;
    elevations_24h: number;
    high_risk_users: number;
    critical_risk_users: number;
    risk_users_total: number;
    oauth_grants_total: number;
    oauth_grants_high_risk: number;
    open_reviews: number;
    last_risk_poll_at: string | null;
    last_oauth_poll_at: string | null;
}

export type PimStatus = "pending" | "active" | "revoked" | "expired" | "failed";

export interface PimElevation {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    target_user_upn: string;
    target_user_id: string;
    role_template_id: string;
    role_display_name: string;
    reason: string;
    requested_by: string | null;
    requested_at: string;
    duration_minutes: number;
    expires_at: string;
    status: PimStatus;
    graph_role_assignment_id: string | null;
    error_message: string | null;
    activated_at: string | null;
    revoked_at: string | null;
    revoked_by: string | null;
    revoke_reason: string | null;
}

export interface SigninRisk {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    user_upn: string;
    user_id: string;
    risk_score: number;
    risk_level: "none" | "low" | "medium" | "high" | "critical";
    risk_factors: Array<{ kind: string; points: number; evidence: string }>;
    signin_count_24h: number;
    failed_signin_24h: number;
    distinct_countries_24h: number;
    distinct_asns_24h: number;
    last_signin_at: string | null;
    last_evaluated_at: string;
}

export interface OAuthGrant {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    grant_id: string;
    client_id: string;
    client_display_name: string | null;
    publisher: string | null;
    consent_type: string | null;
    principal_user_id: string | null;
    principal_upn: string | null;
    scope: string | null;
    high_risk_scopes_matched: string[] | null;
    has_high_risk_scope: boolean;
    risk_score: number;
    risk_level: "low" | "medium" | "high" | "critical";
    first_seen_at: string;
    last_seen_at: string;
    is_active: boolean;
    revoked_at: string | null;
    revoked_by: string | null;
    revoke_reason: string | null;
    deleted_at: string | null;
}

// ----------------------------------------------------------------------------
// Built-in role templates the elevation dialog picks from. Operators can
// type any GUID, but this list covers the high-traffic roles.
// ----------------------------------------------------------------------------
export const PIM_ROLE_TEMPLATES: Array<{ id: string; name: string; warn: boolean }> = [
    { id: "62e90394-69f5-4237-9190-012177145e10", name: "Global Administrator",        warn: true  },
    { id: "e8611ab8-c189-46e8-94e1-60213ab1f814", name: "Privileged Role Administrator", warn: true  },
    { id: "194ae4cb-b126-40b2-bd5b-6091b380977d", name: "Security Administrator",      warn: false },
    { id: "29232cdf-9323-42fd-ade2-1d097af3e4de", name: "Exchange Administrator",      warn: false },
    { id: "f28a1f50-f6e7-4571-818b-6a12f2af6b6c", name: "SharePoint Administrator",    warn: false },
    { id: "fe930be7-5e62-47db-91af-98c3a49a38b1", name: "User Administrator",          warn: false },
    { id: "729827e3-9c14-49f7-bb1b-9608f156bbb8", name: "Helpdesk Administrator",      warn: false },
];

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

export function useShieldOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-shield-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<ShieldOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_shield_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as ShieldOverview | null;
        },
        refetchInterval: 30_000,
    });
}

export function usePimElevations(opts?: { limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const limit = opts?.limit ?? 100;
    return useQuery({
        queryKey: ["pim-elevations", orgId, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<PimElevation[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("pim_elevations")
                .select("*")
                .eq("organization_id", orgId)
                .order("requested_at", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as PimElevation[];
        },
        refetchInterval: 30_000,
    });
}

export function useSigninRisks(opts?: { limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const limit = opts?.limit ?? 100;
    return useQuery({
        queryKey: ["m365-signin-risk", orgId, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<SigninRisk[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_signin_risk")
                .select("*")
                .eq("organization_id", orgId)
                .order("risk_score", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as SigninRisk[];
        },
        refetchInterval: 60_000,
    });
}

export function useOAuthGrants(opts?: { limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const limit = opts?.limit ?? 200;
    return useQuery({
        queryKey: ["m365-oauth-grants", orgId, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<OAuthGrant[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_oauth_grants")
                .select("*")
                .eq("organization_id", orgId)
                .is("deleted_at", null)
                .order("risk_score", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as OAuthGrant[];
        },
        refetchInterval: 5 * 60_000,
    });
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export function useEnableShield() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (enabled: boolean) => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase
                .from("organizations")
                .update({
                    m365_shield_enabled: enabled,
                    m365_shield_enabled_by: enabled ? (user?.id ?? null) : null,
                } as any)
                .eq("id", currentOrganization.id);
            if (error) throw error;
        },
        onSuccess: (_d, enabled) => {
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({
                title: enabled ? "M365 Shield enabled" : "M365 Shield disabled",
                description: enabled
                    ? "PIM auto-revoke, risk scoring, and OAuth inventory will start on the next poll."
                    : "All Shield polling stops immediately for this organization.",
            });
        },
        onError: (e: Error) => toast({ title: "Couldn't update Shield", description: e.message, variant: "destructive" }),
    });
}

export interface ElevateInput {
    target_user_id:    string;
    target_user_upn:   string;
    role_template_id:  string;
    role_display_name: string;
    duration_minutes:  number;
    reason:            string;
}

export function useElevatePim() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: ElevateInput) => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-pim-elevate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        organization_id: currentOrganization.id,
                        ...input,
                    }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["pim-elevations"] });
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({ title: "Elevation active", description: "Auto-revoke at the timer's expiry." });
        },
        onError: (e: Error) => toast({ title: "Couldn't elevate", description: e.message, variant: "destructive" }),
    });
}

export function useRevokePim() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ elevation_id, reason }: { elevation_id: string; reason?: string }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-pim-auto-revoke`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ elevation_id, reason }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["pim-elevations"] });
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({ title: "Elevation revoked" });
        },
        onError: (e: Error) => toast({ title: "Couldn't revoke", description: e.message, variant: "destructive" }),
    });
}

export function useRevokeOAuthGrant() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ grant_id, reason }: { grant_id: string; reason?: string }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-oauth-revoke`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ grant_id, reason }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["m365-oauth-grants"] });
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({ title: "Grant revoked" });
        },
        onError: (e: Error) => toast({ title: "Couldn't revoke grant", description: e.message, variant: "destructive" }),
    });
}

// ----------------------------------------------------------------------------
// Labels + helpers
// ----------------------------------------------------------------------------

export const RISK_LEVEL_LABEL: Record<string, string> = {
    none: "None", low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const RISK_LEVEL_TONE: Record<string, string> = {
    none:     "bg-slate-100 text-slate-700",
    low:      "bg-emerald-100 text-emerald-800",
    medium:   "bg-amber-100 text-amber-800",
    high:     "bg-orange-100 text-orange-800",
    critical: "bg-rose-100 text-rose-800",
};

export const PIM_STATUS_TONE: Record<PimStatus, string> = {
    pending:  "bg-slate-100 text-slate-700",
    active:   "bg-emerald-100 text-emerald-800",
    revoked:  "bg-slate-100 text-slate-700",
    expired:  "bg-slate-100 text-slate-700",
    failed:   "bg-rose-100 text-rose-800",
};

// ----------------------------------------------------------------------------
// Access Reviews
// ----------------------------------------------------------------------------

export type ReviewKind = "admin" | "guest" | "mailbox_delegate" | "shared_mailbox";

export interface AccessReview {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    review_kind: ReviewKind;
    created_at: string;
    created_by: string | null;
    due_at: string;
    completed_at: string | null;
    completed_by: string | null;
    item_count: number;
    kept_count: number;
    removed_count: number;
    notes: string | null;
}

export interface AccessReviewItem {
    id: string;
    review_id: string;
    subject_id: string;
    subject_label: string;
    detail: Record<string, unknown>;
    decision: "keep" | "remove" | null;
    decided_at: string | null;
    decided_by: string | null;
    enforced_at: string | null;
    enforcement_error: string | null;
}

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
    admin:            "Privileged admins",
    guest:            "External guests",
    mailbox_delegate: "Mailbox delegates",
    shared_mailbox:   "Shared mailboxes",
};

export function useAccessReviews() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["access-reviews", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<AccessReview[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_access_reviews")
                .select("*")
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false });
            if (error) throw error;
            return (data ?? []) as AccessReview[];
        },
    });
}

export function useAccessReviewItems(reviewId: string | null) {
    return useQuery({
        queryKey: ["access-review-items", reviewId],
        enabled: !!reviewId,
        queryFn: async (): Promise<AccessReviewItem[]> => {
            if (!reviewId) return [];
            const { data, error } = await supabase
                .from("m365_access_review_items")
                .select("*")
                .eq("review_id", reviewId)
                .order("subject_label", { ascending: true });
            if (error) throw error;
            return (data ?? []) as AccessReviewItem[];
        },
    });
}

export function useCreateAccessReview() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: { review_kind: ReviewKind; due_days?: number }) => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-access-review-create`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({
                        organization_id: currentOrganization.id,
                        review_kind:     input.review_kind,
                        due_days:        input.due_days ?? 14,
                    }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["access-reviews"] });
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({ title: "Review created", description: `${r.item_count ?? 0} subjects to review.` });
        },
        onError: (e: Error) => toast({ title: "Couldn't create review", description: e.message, variant: "destructive" }),
    });
}

// ----------------------------------------------------------------------------
// External Sharing Audit
// ----------------------------------------------------------------------------

export interface SharingOverview {
    total_active: number;
    external_active: number;
    anonymous_links: number;
    suspicious_domains: number;
    dormant_over_90d: number;
    high_risk: number;
    last_poll_at: string | null;
}

export interface SharedItem {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    drive_id: string;
    drive_owner: string | null;
    drive_kind: "onedrive" | "sharepoint" | "teams";
    item_id: string;
    item_name: string | null;
    item_path: string | null;
    item_type: string | null;
    item_web_url: string | null;
    item_size_bytes: number | null;
    item_last_modified_at: string | null;
    permission_id: string;
    link_scope: string | null;
    link_type: string | null;
    granted_to_email: string | null;
    granted_to_display_name: string | null;
    granted_at: string | null;
    expires_at: string | null;
    is_external: boolean;
    is_anonymous_link: boolean;
    is_suspicious_domain: boolean;
    dormant_days: number | null;
    risk_score: number;
    risk_factors: Array<{ kind: string; points: number; evidence: string }>;
    removed_at: string | null;
}

export type SharingFilter = "external" | "anonymous" | "suspicious" | "dormant" | "all";

export function useSharingOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-sharing-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<SharingOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_sharing_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as SharingOverview | null;
        },
        refetchInterval: 5 * 60_000,
    });
}

export function useSharedItems(opts?: { filter?: SharingFilter; limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const filter = opts?.filter ?? "external";
    const limit = opts?.limit ?? 200;
    return useQuery({
        queryKey: ["m365-shared-items", orgId, filter, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<SharedItem[]> => {
            if (!orgId) return [];
            let q = supabase
                .from("m365_shared_items")
                .select("*")
                .eq("organization_id", orgId)
                .is("removed_at", null);
            if (filter === "external")    q = q.eq("is_external", true);
            if (filter === "anonymous")   q = q.eq("is_anonymous_link", true);
            if (filter === "suspicious")  q = q.eq("is_suspicious_domain", true);
            if (filter === "dormant")     q = q.gt("dormant_days", 90);
            const { data, error } = await q.order("risk_score", { ascending: false }).limit(limit);
            if (error) throw error;
            return (data ?? []) as SharedItem[];
        },
    });
}

export function useUnshare() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ shared_item_id, reason }: { shared_item_id: string; reason?: string }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-sharing-unshare`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({ shared_item_id, reason }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["m365-shared-items"] });
            qc.invalidateQueries({ queryKey: ["m365-sharing-overview"] });
            toast({ title: "Share revoked" });
        },
        onError: (e: Error) => toast({ title: "Couldn't unshare", description: e.message, variant: "destructive" }),
    });
}

// ----------------------------------------------------------------------------
// Lifecycle workflows
// ----------------------------------------------------------------------------

export interface LifecycleWorkflow {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    kind: "leaver" | "joiner" | "mover";
    target_user_id: string;
    target_user_upn: string;
    target_user_display: string | null;
    manager_upn: string | null;
    requested_by: string | null;
    requested_at: string;
    reason: string | null;
    status: "pending" | "running" | "completed" | "partial" | "failed";
    started_at: string | null;
    completed_at: string | null;
    options: Record<string, unknown>;
    steps: Array<{ step: string; ok: boolean; detail?: string }>;
    error_summary: string | null;
}

export function useLifecycleWorkflows(opts?: { limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const limit = opts?.limit ?? 50;
    return useQuery({
        queryKey: ["lifecycle-workflows", orgId, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<LifecycleWorkflow[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("lifecycle_workflows")
                .select("*")
                .eq("organization_id", orgId)
                .order("requested_at", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as LifecycleWorkflow[];
        },
        refetchInterval: 30_000,
    });
}

export interface LeaverInput {
    target_user_upn: string;
    manager_upn?: string;
    reason?: string;
    options?: {
        revoke_sessions?: boolean;
        disable_account?: boolean;
        remove_from_groups?: boolean;
        out_of_office?: boolean;
        forward_to_manager?: boolean;
    };
}

export function useRunLeaver() {
    const { currentOrganization } = useTenant();
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: LeaverInput) => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-lifecycle-leaver`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({
                        organization_id: currentOrganization.id,
                        ...input,
                    }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["lifecycle-workflows"] });
            const pct = r.status === "completed" ? "completed" : `${r.status} (${r.steps?.filter((s: any) => s.ok).length}/${r.steps?.length} steps OK)`;
            toast({ title: "Leaver workflow " + pct });
        },
        onError: (e: Error) => toast({ title: "Couldn't offboard user", description: e.message, variant: "destructive" }),
    });
}

// ----------------------------------------------------------------------------
// Sign-in Geo
// ----------------------------------------------------------------------------

export interface SigninGeoRow {
    country_code: string;
    signin_count: number;
    unique_users: number;
    high_risk_count: number;
}

export function useSigninGeo(days = 7) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-signin-geo", orgId, days],
        enabled: !!orgId,
        queryFn: async (): Promise<SigninGeoRow[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase.rpc("get_m365_signin_geo", { p_org_id: orgId, p_days: days });
            if (error) throw error;
            return (data ?? []) as SigninGeoRow[];
        },
        refetchInterval: 5 * 60_000,
    });
}

// ----------------------------------------------------------------------------
// Dark Web Breach Monitoring (HIBP)
// ----------------------------------------------------------------------------

export interface BreachOverview {
    domains_total: number;
    domains_verified: number;
    domains_with_api_key: number;
    domains_polling_ok: number;
    users_breached: number;
    findings_total: number;
    findings_unack: number;
    findings_new_24h: number;
    findings_new_30d: number;
    findings_hibp: number;
    findings_hudson_rock: number;
    findings_github: number;
    last_poll_at: string | null;
}

export interface BreachSubscription {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    domain: string;
    has_api_key: boolean;
    verified_at: string | null;
    last_polled_at: string | null;
    last_poll_status: string | null;
    last_poll_error: string | null;
    last_poll_findings_count: number;
    hudson_rock_enabled: boolean;
    hudson_rock_last_polled_at: string | null;
    hudson_rock_last_findings_count: number;
    github_enabled: boolean;
    github_last_polled_at: string | null;
    github_last_findings_count: number;
    is_enabled: boolean;
}

export type BreachSource = "hibp" | "hudson_rock" | "github_leak";

export const BREACH_SOURCE_LABEL: Record<BreachSource, { label: string; tone: string; description: string }> = {
    hibp:        { label: "HIBP",           tone: "bg-blue-100 text-blue-800",   description: "Have I Been Pwned — historic breach dumps" },
    hudson_rock: { label: "Hudson Rock",    tone: "bg-rose-100 text-rose-800",   description: "Hudson Rock Cavalier — active infostealer logs (FREE)" },
    github_leak: { label: "GitHub leak",    tone: "bg-amber-100 text-amber-800", description: "Public GitHub repos — accidental credential commits (FREE)" },
};

export interface BreachFinding {
    id: string;
    organization_id: string;
    user_upn: string;
    breach_name: string;
    breach_title: string | null;
    breach_date: string | null;
    pwn_count: number | null;
    breach_domain: string | null;
    description: string | null;
    data_classes: string[];
    is_verified: boolean | null;
    is_sensitive: boolean | null;
    logo_path: string | null;
    first_seen_at: string;
    last_seen_at: string;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
    acknowledge_note: string | null;
    source: BreachSource;
    source_detail: Record<string, unknown>;
}

export function useBreachOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-breach-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<BreachOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_breach_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as BreachOverview | null;
        },
        refetchInterval: 5 * 60_000,
    });
}

export function useBreachSubscriptions() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-breach-subscriptions", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<BreachSubscription[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_breach_monitoring_safe")
                .select("*")
                .eq("organization_id", orgId)
                .order("domain", { ascending: true });
            if (error) throw error;
            return (data ?? []) as BreachSubscription[];
        },
    });
}

export function useBreachFindings(opts?: { unackOnly?: boolean; limit?: number }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const unack = opts?.unackOnly ?? false;
    const limit = opts?.limit ?? 200;
    return useQuery({
        queryKey: ["m365-breach-findings", orgId, unack, limit],
        enabled: !!orgId,
        queryFn: async (): Promise<BreachFinding[]> => {
            if (!orgId) return [];
            let q = supabase
                .from("m365_breach_findings")
                .select("*")
                .eq("organization_id", orgId);
            if (unack) q = q.is("acknowledged_at", null);
            const { data, error } = await q
                .order("first_seen_at", { ascending: false })
                .limit(limit);
            if (error) throw error;
            return (data ?? []) as BreachFinding[];
        },
    });
}

// Pull tenant domains so the setup flow can list them
export function useTenantDomains() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-tenant-records", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<Array<{ tenant_pk: string; tenant_id: string; tenant_display_name: string | null; tenant_domain: string | null }>> => {
            if (!orgId) return [];
            const { data, error } = await supabase
                .from("m365_tenants")
                .select("id, tenant_id, tenant_display_name, tenant_domain")
                .eq("organization_id", orgId)
                .eq("consent_state", "active");
            if (error) throw error;
            return (data ?? []).map((t: any) => ({
                tenant_pk: t.id,
                tenant_id: t.tenant_id,
                tenant_display_name: t.tenant_display_name,
                tenant_domain: t.tenant_domain,
            }));
        },
    });
}

export function useBreachSetup() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: { tenant_pk: string; domain: string; hibp_api_key?: string; action: "save" | "remove" | "test" }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-breach-setup`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify(input),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.detail ?? body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["m365-breach-subscriptions"] });
            qc.invalidateQueries({ queryKey: ["m365-breach-overview"] });
            if (r.action === "saved")    toast({ title: "Breach monitoring enabled", description: r.domain });
            else if (r.action === "removed") toast({ title: "API key removed" });
            else if (r.action === "tested")  toast({ title: "HIBP key verified" });
        },
        onError: (e: Error) => toast({ title: "Couldn't configure HIBP", description: e.message, variant: "destructive" }),
    });
}

export function useAcknowledgeBreach() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ finding_id, note }: { finding_id: string; note?: string }) => {
            const { error } = await supabase.rpc("acknowledge_breach_finding", { p_finding_id: finding_id, p_note: note ?? null });
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["m365-breach-findings"] });
            qc.invalidateQueries({ queryKey: ["m365-breach-overview"] });
            toast({ title: "Finding acknowledged" });
        },
        onError: (e: Error) => toast({ title: "Couldn't acknowledge", description: e.message, variant: "destructive" }),
    });
}

// ----------------------------------------------------------------------------
// Privileged Group Audit
// ----------------------------------------------------------------------------

export interface PrivilegedAuditRow {
    user_id: string;
    user_upn: string;
    display_name: string | null;
    admin_roles: string[];
    is_global_admin: boolean;
    is_mfa_registered: boolean;
    methods_registered: string[];
    last_signin_at: string | null;
    days_since_signin: number | null;
    risk_score: number;
    risk_flags: string[];
}

export interface PrivilegedAuditSummary {
    total_admins: number;
    admins_no_mfa: number;
    admins_dormant_90d: number;
    admins_never_seen: number;
    global_admins: number;
    global_admins_no_mfa: number;
    high_risk_admins: number;
}

export function usePrivilegedAuditSummary() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-privileged-audit-summary", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<PrivilegedAuditSummary | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_privileged_audit_summary", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as PrivilegedAuditSummary | null;
        },
        refetchInterval: 5 * 60_000,
    });
}

export function usePrivilegedAuditRows() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-privileged-audit-rows", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<PrivilegedAuditRow[]> => {
            if (!orgId) return [];
            const { data, error } = await supabase.rpc("get_m365_privileged_audit", { p_org_id: orgId });
            if (error) throw error;
            return (data ?? []) as PrivilegedAuditRow[];
        },
    });
}

export const RISK_FLAG_LABEL: Record<string, { label: string; tone: string }> = {
    no_mfa:          { label: "No MFA",         tone: "bg-rose-100 text-rose-800" },
    global_admin:    { label: "Global Admin",   tone: "bg-amber-100 text-amber-800" },
    never_signed_in: { label: "Never seen",     tone: "bg-rose-100 text-rose-800" },
    dormant_180d:    { label: "Dormant >180d",  tone: "bg-rose-100 text-rose-800" },
    dormant_90d:     { label: "Dormant >90d",   tone: "bg-amber-100 text-amber-800" },
    dormant_30d:     { label: "Dormant >30d",   tone: "bg-slate-100 text-slate-700" },
};

// ----------------------------------------------------------------------------
// MFA Coverage
// ----------------------------------------------------------------------------

export interface MfaCoverageOverview {
    total_users: number;
    users_mfa_registered: number;
    users_mfa_capable_unreg: number;
    users_no_mfa_capability: number;
    admins_total: number;
    admins_mfa_registered: number;
    admins_at_risk: number;
    pct_users_with_mfa: number;
    pct_admins_with_mfa: number;
    last_evaluated_at: string | null;
}

export interface MfaCoverageRow {
    id: string;
    organization_id: string;
    m365_tenant_id: string;
    user_id: string;
    user_upn: string;
    display_name: string | null;
    is_mfa_capable: boolean;
    is_mfa_registered: boolean;
    is_passwordless_capable: boolean;
    is_sspr_registered: boolean;
    methods_registered: string[];
    primary_method: string | null;
    is_admin: boolean;
    admin_roles: string[];
    last_signin_at: string | null;
    last_evaluated_at: string;
}

export function useMfaCoverageOverview() {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    return useQuery({
        queryKey: ["m365-mfa-coverage-overview", orgId],
        enabled: !!orgId,
        queryFn: async (): Promise<MfaCoverageOverview | null> => {
            if (!orgId) return null;
            const { data, error } = await supabase.rpc("get_m365_mfa_coverage_overview", { p_org_id: orgId });
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            return (row ?? null) as MfaCoverageOverview | null;
        },
        refetchInterval: 5 * 60_000,
    });
}

export function useMfaCoverageRows(opts?: { filter?: "all" | "no_mfa" | "admins_no_mfa" }) {
    const { currentOrganization } = useTenant();
    const orgId = currentOrganization?.id ?? null;
    const filter = opts?.filter ?? "all";
    return useQuery({
        queryKey: ["m365-mfa-coverage-rows", orgId, filter],
        enabled: !!orgId,
        queryFn: async (): Promise<MfaCoverageRow[]> => {
            if (!orgId) return [];
            let q = supabase
                .from("m365_mfa_coverage")
                .select("*")
                .eq("organization_id", orgId);
            if (filter === "no_mfa") q = q.eq("is_mfa_registered", false);
            if (filter === "admins_no_mfa") q = q.eq("is_admin", true).eq("is_mfa_registered", false);
            const { data, error } = await q
                .order("is_admin", { ascending: false })
                .order("user_upn", { ascending: true })
                .limit(500);
            if (error) throw error;
            return (data ?? []) as MfaCoverageRow[];
        },
    });
}

// ----------------------------------------------------------------------------
// Shield-wide manual scan: fan out to every poller in one shot
// ----------------------------------------------------------------------------

export type ScanAllState = "ok" | "no_data" | "requires_premium" | "requires_consent" | "config_missing" | "graph_error" | "error";
export interface ScanAllPollerResult {
    slug: string;
    label: string;
    ok: boolean;
    http_status: number;
    state?: ScanAllState;
    detail?: string;
    missing_scope?: string;
    summary?: { tenants?: number; updated?: number; tenants_ok?: number; tenants_failed?: number };
    error?: string;
    elapsed_ms: number;
}
export interface ScanAllResponse {
    ok: true;
    summary: { total: number; ok: number; no_data: number; requires_premium: number; requires_consent: number; config_missing: number; failed: number };
    results: ScanAllPollerResult[];
}

export function useShieldScanAll() {
    const qc = useQueryClient();
    const { currentOrganization } = useTenant();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (): Promise<ScanAllResponse> => {
            if (!currentOrganization?.id) throw new Error("no_org");
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-shield-scan-all`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({ organization_id: currentOrganization.id }),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.detail ?? body?.error ?? `http_${resp.status}`);
            return body as ScanAllResponse;
        },
        onSuccess: (data) => {
            // Refresh every Shield query group
            const keys = [
                "m365-shield-overview",
                "m365-pim-elevations",
                "m365-signin-risks",
                "m365-oauth-grants",
                "m365-conditional-access",
                "m365-mfa-coverage-overview",
                "m365-mfa-coverage-rows",
                "m365-sharing-overview",
                "m365-shared-items",
                "m365-privileged-audit-summary",
                "m365-privileged-audit-rows",
                "m365-breach-overview",
                "m365-breach-subscriptions",
                "m365-breach-findings",
            ];
            for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
            const { ok, no_data, requires_premium, requires_consent, config_missing, failed, total } = data.summary;
            const parts: string[] = [];
            if (ok > 0)               parts.push(`${ok} refreshed`);
            if (no_data > 0)          parts.push(`${no_data} nothing-to-report`);
            if (requires_consent > 0) parts.push(`${requires_consent} need tenant reconnect`);
            if (requires_premium > 0) parts.push(`${requires_premium} need Entra P1`);
            if (config_missing > 0)   parts.push(`${config_missing} need setup`);
            if (failed > 0)           parts.push(`${failed} failed`);
            const desc = parts.length > 0 ? parts.join(" · ") : `${total} source${total === 1 ? "" : "s"} processed.`;
            toast({
                title: failed > 0 ? `Scan finished with ${failed} error${failed > 1 ? "s" : ""}` : `Scan complete`,
                description: desc,
                variant: failed > 0 ? "destructive" : "default",
            });
        },
        onError: (e: Error) => toast({
            title: e.message === "rate_limited" || /A scan is already/.test(e.message)
                ? "Too soon — wait a moment"
                : "Couldn't run scan",
            description: e.message,
            variant: "destructive",
        }),
    });
}

export function useDecideReviewItem() {
    const qc = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: { item_id: string; decision: "keep" | "remove" }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("no_session");
            const resp = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-access-review-enforce`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify(input),
                },
            );
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body?.error ?? `http_${resp.status}`);
            return body;
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ["access-review-items"] });
            qc.invalidateQueries({ queryKey: ["access-reviews"] });
            qc.invalidateQueries({ queryKey: ["m365-shield-overview"] });
            toast({ title: vars.decision === "remove" ? "Subject removed" : "Subject kept" });
        },
        onError: (e: Error) => toast({ title: "Couldn't record decision", description: e.message, variant: "destructive" }),
    });
}
