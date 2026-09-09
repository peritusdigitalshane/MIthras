import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");

async function call(fn: string, body: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const resp = await fetch(`${FUNCTIONS_BASE}/functions/v1/${fn}`, {
        method: "POST",
        // credentials:'include' is REQUIRED for the browser to commit the
        // Set-Cookie that m365-oauth-start sends back (the nonce cookie
        // that binds the OAuth flow to this browser session). Without it
        // the cookie is dropped, the callback sees no nonce, and every
        // M365 connect attempt fails with session_mismatch.
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
    return json;
}

export interface M365Tenant {
    id: string;
    organization_id: string;
    tenant_id: string;
    tenant_display_name: string | null;
    tenant_domain: string | null;
    scopes: string[];
    consent_state: "pending" | "active" | "failed" | "revoked";
    remediation_enabled: boolean;
    remediation_scopes: string[];
    access_token_expires_at: string | null;
    last_poll_at: string | null;
    last_poll_error: string | null;
    created_at: string;
}

export function useM365Tenants() {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["m365-tenants", currentOrganization?.id],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            const { data, error } = await supabase
                .from("m365_tenants_view")
                .select("*")
                .eq("organization_id", currentOrganization.id)
                .order("created_at", { ascending: false });
            if (error) throw error;
            return (data ?? []) as M365Tenant[];
        },
        enabled: !!currentOrganization?.id,
    });
}

export interface M365SignInEvent {
    id: string;
    m365_tenant_id: string;
    user_principal_name: string | null;
    user_display_name: string | null;
    app_display_name: string | null;
    ip_address: string | null;
    country: string | null;
    city: string | null;
    risk_level: string | null;
    risk_state: string | null;
    risk_event_types: string[] | null;
    status_error_code: number | null;
    occurred_at: string;
}

export function useM365SignIns(opts: { riskyOnly?: boolean; limit?: number } = {}) {
    const { currentOrganization } = useTenant();
    const limit = opts.limit ?? 50;
    return useQuery({
        queryKey: ["m365-signins", currentOrganization?.id, opts.riskyOnly, limit],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            let q = supabase
                .from("m365_sign_in_events")
                .select("*")
                .eq("organization_id", currentOrganization.id)
                .order("occurred_at", { ascending: false })
                .limit(limit);
            if (opts.riskyOnly) q = q.in("risk_level", ["medium", "high"]);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as M365SignInEvent[];
        },
        enabled: !!currentOrganization?.id,
    });
}

export interface M365MailboxRule {
    id: string;
    m365_tenant_id: string;
    user_principal_name: string;
    rule_id: string;
    rule_name: string | null;
    enabled: boolean;
    is_active: boolean;
    forwards_externally: boolean;
    forward_to_addresses: string[] | null;
    moves_to_folder: string | null;
    deletes_messages: boolean;
    last_seen_at: string;
}

export function useM365ForwardingRules() {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["m365-forwarding-rules", currentOrganization?.id],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            const { data, error } = await supabase
                .from("m365_mailbox_rules")
                .select("*")
                .eq("organization_id", currentOrganization.id)
                .eq("forwards_externally", true)
                .eq("is_active", true)
                .order("last_seen_at", { ascending: false })
                .limit(100);
            if (error) throw error;
            return (data ?? []) as M365MailboxRule[];
        },
        enabled: !!currentOrganization?.id,
    });
}

export interface M365OAuthGrant {
    id: string;
    m365_tenant_id: string;
    client_id: string;
    client_display_name: string | null;
    consent_type: string | null;
    principal_upn: string | null;
    scope: string | null;
    has_high_risk_scope: boolean;
    high_risk_scopes_matched: string[] | null;
    is_active: boolean;
    last_seen_at: string;
}

export function useM365HighRiskOAuthGrants() {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["m365-oauth-high-risk", currentOrganization?.id],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            const { data, error } = await supabase
                .from("m365_oauth_grants")
                .select("*")
                .eq("organization_id", currentOrganization.id)
                .eq("has_high_risk_scope", true)
                .eq("is_active", true)
                .order("last_seen_at", { ascending: false })
                .limit(100);
            if (error) throw error;
            return (data ?? []) as M365OAuthGrant[];
        },
        enabled: !!currentOrganization?.id,
    });
}

export function useM365Alerts() {
    const { currentOrganization } = useTenant();
    return useQuery({
        queryKey: ["m365-alerts", currentOrganization?.id],
        queryFn: async () => {
            if (!currentOrganization?.id) return [];
            const { data, error } = await supabase
                .from("alerts")
                .select("*")
                .eq("organization_id", currentOrganization.id)
                .like("alert_type", "m365_%")
                .order("created_at", { ascending: false })
                .limit(50);
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!currentOrganization?.id,
    });
}

// Lightweight check: is the Azure app registration configured at the platform
// level? Used by the M365 page to show an inline "configure Azure first"
// banner so super-admins don't burn a click on a silent 503.
export function useM365AzureConfigured() {
    return useQuery({
        queryKey: ["m365-azure-configured"],
        queryFn: async () => {
            const { data } = await supabase
                .from("platform_settings")
                .select("key, value")
                .in("key", ["m365_azure_client_id", "m365_azure_redirect_uri"]);
            const rows = (data ?? []) as Array<{ key: string; value: string | null }>;
            const byKey = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, string | null>;
            return {
                hasClientId:    !!byKey.m365_azure_client_id?.trim(),
                hasRedirectUri: !!byKey.m365_azure_redirect_uri?.trim(),
                configured:     !!byKey.m365_azure_client_id?.trim() && !!byKey.m365_azure_redirect_uri?.trim(),
            };
        },
        staleTime: 60_000,
    });
}

export function useStartM365Connect() {
    const { currentOrganization } = useTenant();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (args: { mode: "read_only" | "remediation"; m365TenantId?: string | null }) => {
            if (!currentOrganization?.id) throw new Error("No organisation selected");
            const r = await call("m365-oauth-start", {
                organization_id: currentOrganization.id,
                mode: args.mode,
                // For remediation upgrades the operator clicked a specific
                // tenant row. Forwarding the m365_tenants.id lets the start
                // function look up the bound Azure tid + sign it into state;
                // the callback then refuses the consent if Microsoft returns
                // a different tid (e.g. operator picked the wrong account in
                // the picker). Stops cross-tenant consent mis-assignment.
                m365_tenant_id: args.m365TenantId ?? null,
            });
            return r as { consent_url: string };
        },
        onSuccess: (r) => { window.location.assign(r.consent_url); },
        onError: (err: any) => {
            // Surface the failure instead of silently rejecting. Most common
            // shape we hit: 503 m365_integration_not_configured when the
            // Azure app credentials haven't been entered yet. Send the user
            // to where they can fix it.
            const raw = String(err?.message ?? err ?? "");
            if (raw.includes("m365_integration_not_configured")) {
                toast({
                    title: "Microsoft 365 isn't configured yet",
                    description: "An admin needs to set the Azure app credentials at Admin → Platform settings before any tenant can be connected.",
                    variant: "destructive",
                });
                return;
            }
            if (raw.includes("forbidden_admin_required")) {
                toast({
                    title: "You don't have admin rights on this org",
                    description: "Switch to the tenant you administer or ask its owner to connect Microsoft 365.",
                    variant: "destructive",
                });
                return;
            }
            toast({
                title: "Couldn't start the Microsoft 365 connection",
                description: raw || "Unknown error.",
                variant: "destructive",
            });
        },
    });
}

export function usePollM365Tenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tenantPk: string) => {
            return await call("m365-poll-tenants", { m365_tenant_id: tenantPk });
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["m365-tenants"] });
            qc.invalidateQueries({ queryKey: ["m365-signins"] });
            qc.invalidateQueries({ queryKey: ["m365-forwarding-rules"] });
            qc.invalidateQueries({ queryKey: ["m365-oauth-high-risk"] });
            qc.invalidateQueries({ queryKey: ["m365-alerts"] });
            // m365 polling surfaces risky sign-ins which feed
            // m365RiskySignIns24h on the SOC counter strip.
            qc.invalidateQueries({ queryKey: ["soc-counters"] });
        },
    });
}

export function useDisconnectM365Tenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tenantPk: string) => {
            // Soft-revoke locally — we can't revoke the consent server-side
            // without calling Graph, which we leave to the admin via
            // portal.azure.com. Mark consent_state='revoked' so the poller
            // skips this tenant and tokens are no longer used. The row
            // stays for audit purposes (who connected it, when, last poll
            // state at disconnect time).
            const { error } = await supabase
                .from("m365_tenants")
                .update({
                    consent_state: "revoked",
                    access_token: null,
                    refresh_token: null,
                })
                .eq("id", tenantPk);
            if (error) throw error;
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["m365-tenants"] });
        },
    });
}

/**
 * Hard-delete a tenant row. ON DELETE CASCADE on the FK columns means
 * every ingested sign-in event, audit event, mailbox rule, and OAuth
 * grant for this tenant is also removed. Use when you want a clean
 * "this customer was never connected" state — for testing, or when a
 * customer leaves and you must purge their telemetry.
 *
 * Does NOT revoke the Azure-side consent. The customer's Global Admin
 * must do that in Entra ID → Enterprise applications → Mithras ITDR →
 * Permissions → Revoke admin consent. Mention this to the operator.
 */
export function useDeleteM365Tenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tenantPk: string) => {
            const { error } = await supabase
                .from("m365_tenants")
                .delete()
                .eq("id", tenantPk);
            if (error) throw error;
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["m365-tenants"] });
            qc.invalidateQueries({ queryKey: ["m365-signins"] });
            qc.invalidateQueries({ queryKey: ["m365-forwarding-rules"] });
            qc.invalidateQueries({ queryKey: ["m365-oauth-high-risk"] });
            qc.invalidateQueries({ queryKey: ["m365-alerts"] });
            qc.invalidateQueries({ queryKey: ["soc-counters"] });
        },
    });
}
