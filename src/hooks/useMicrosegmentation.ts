import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export interface SourceCount {
  ip: string;
  count: number;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface MicrosegRuleStats {
  rule_id: string;
  service_name: string;
  port: string;
  protocol: string;
  action: string;
  mode: "audit" | "enforce";
  enabled: boolean;
  endpoint_group_id: string;
  group_name: string;
  policy_id: string;
  allowed_source_ips: string[];

  hits_24h: number;
  hits_7d: number;
  unique_sources_24h: number;
  unique_sources_7d: number;
  unique_endpoints_7d: number;
  last_seen: string | null;
  top_sources: SourceCount[];
  hits_by_day: DayCount[];
  sparkline: number[];
  audit_started_at: string | null;
}

function buildSparkline(daily: DayCount[]): number[] {
  const byDay = new Map<string, number>();
  for (const d of daily) byDay.set(d.day, d.count);
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) || 0);
  }
  return out;
}

export function useMicrosegmentationRules() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["microseg-rules", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const [rulesRes, statsRes] = await Promise.all([
        supabase
          .from("firewall_service_rules")
          .select(`
            id,
            service_name,
            port,
            protocol,
            action,
            mode,
            enabled,
            endpoint_group_id,
            policy_id,
            allowed_source_ips,
            firewall_policies!inner(organization_id),
            endpoint_groups!inner(name)
          `)
          .eq("firewall_policies.organization_id", orgId)
          .order("service_name"),
        (supabase.rpc as any)("get_microseg_rule_stats", { p_org_id: orgId }),
      ]);

      if (rulesRes.error) throw rulesRes.error;
      if (statsRes.error) throw statsRes.error;

      type Stat = {
        rule_id: string;
        hits_24h: number;
        hits_7d: number;
        unique_sources_24h: number;
        unique_sources_7d: number;
        unique_endpoints_7d: number;
        last_seen: string | null;
        top_sources: SourceCount[];
        hits_by_day: DayCount[];
        audit_started_at: string | null;
      };
      const statsByRule = new Map<string, Stat>();
      for (const s of (statsRes.data || []) as Stat[]) {
        statsByRule.set(s.rule_id, s);
      }

      return ((rulesRes.data || []) as any[]).map((r): MicrosegRuleStats => {
        const s = statsByRule.get(r.id);
        const daily = s?.hits_by_day || [];
        return {
          rule_id: r.id,
          service_name: r.service_name,
          port: r.port,
          protocol: r.protocol,
          action: r.action,
          mode: r.mode,
          enabled: r.enabled,
          endpoint_group_id: r.endpoint_group_id,
          group_name: r.endpoint_groups?.name || "Unknown group",
          policy_id: r.policy_id,
          allowed_source_ips: r.allowed_source_ips || [],

          hits_24h: Number(s?.hits_24h || 0),
          hits_7d: Number(s?.hits_7d || 0),
          unique_sources_24h: Number(s?.unique_sources_24h || 0),
          unique_sources_7d: Number(s?.unique_sources_7d || 0),
          unique_endpoints_7d: Number(s?.unique_endpoints_7d || 0),
          last_seen: s?.last_seen || null,
          top_sources: s?.top_sources || [],
          hits_by_day: daily,
          sparkline: buildSparkline(daily),
          audit_started_at: s?.audit_started_at ?? null,
        };
      });
    },
    enabled: !!orgId,
  });
}

export interface RuleEndpointBreakdown {
  endpoint_id: string;
  hostname: string;
  hits_7d: number;
  unique_sources: number;
  last_seen: string;
  top_sources: SourceCount[];
}

export function useMicrosegRuleEndpoints(ruleId: string | null) {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["microseg-rule-endpoints", orgId, ruleId],
    queryFn: async () => {
      if (!orgId || !ruleId) return [];
      const { data, error } = await (supabase.rpc as any)(
        "get_microseg_rule_endpoint_breakdown",
        { p_org_id: orgId, p_rule_id: ruleId }
      );
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        hits_7d: Number(r.hits_7d),
        unique_sources: Number(r.unique_sources),
      })) as RuleEndpointBreakdown[];
    },
    enabled: !!orgId && !!ruleId,
  });
}

export function useAllowSource() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ ruleId, ip }: { ruleId: string; ip: string }) => {
      const { data, error } = await (supabase.rpc as any)("firewall_rule_allow_source", {
        p_rule_id: ruleId,
        p_ip: ip,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { ip }) => {
      queryClient.invalidateQueries({ queryKey: ["microseg-rules"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({
        title: "Source allowed",
        description: `${ip} added to the rule's allowed-source whitelist.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to allow source",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Endpoint-centric microseg ---------------------------------------------------

export type EndpointMicrosegState = "idle" | "learning" | "enforcing";

export interface EndpointMicrosegTrafficRow {
  local_port: number;
  protocol: string;
  service_name: string | null;
  hits_24h: number;
  hits_7d: number;
  unique_sources: number;
  last_seen: string | null;
  top_sources: SourceCount[];
}

export interface EndpointMicrosegSnapshot {
  endpoint_id: string;
  state: EndpointMicrosegState;
  observation_started_at: string | null;
  enforce_started_at: string | null;
  traffic: EndpointMicrosegTrafficRow[];
}

export type Direction = "inbound" | "outbound";

export function useEndpointMicroseg(endpointId: string | null | undefined, direction: Direction = "inbound") {
  return useQuery({
    queryKey: ["endpoint-microseg", endpointId, direction],
    enabled: !!endpointId,
    queryFn: async () => {
      if (!endpointId) return null;
      const { data, error } = await (supabase.rpc as any)("get_endpoint_microseg", {
        p_endpoint_id: endpointId,
        p_direction:   direction,
      });
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        traffic: (data.traffic ?? []).map((r: any) => ({
          ...r,
          local_port: Number(r.local_port),
          hits_24h: Number(r.hits_24h),
          hits_7d: Number(r.hits_7d),
          unique_sources: Number(r.unique_sources),
          top_sources: (r.top_sources ?? []) as SourceCount[],
        })),
      } as EndpointMicrosegSnapshot;
    },
    refetchInterval: 30000,
  });
}

export function useStartLearning() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId, direction = "inbound" as Direction }: { endpointId: string; direction?: Direction }) => {
      const { error } = await (supabase.rpc as any)("endpoint_microseg_start_learning", {
        p_endpoint_id: endpointId, p_direction: direction,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-microseg", vars.endpointId, vars.direction] });
      toast({
        title: "Learning started",
        description: `Now observing ${vars.direction ?? "inbound"} traffic. Click Enforce when you're ready to lock down.`,
      });
    },
    onError: (e: Error) => toast({ title: "Failed to start learning", description: e.message, variant: "destructive" }),
  });
}

export function useStopMicroseg() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId, direction = "inbound" as Direction }: { endpointId: string; direction?: Direction }) => {
      const { error } = await (supabase.rpc as any)("endpoint_microseg_stop", {
        p_endpoint_id: endpointId, p_direction: direction,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-microseg", vars.endpointId, vars.direction] });
      toast({ title: "Stopped", description: `${vars.direction ?? "Inbound"} is back to idle.` });
    },
    onError: (e: Error) => toast({ title: "Failed to stop", description: e.message, variant: "destructive" }),
  });
}

export function useEnforceMicroseg() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ endpointId, direction = "inbound" as Direction }: { endpointId: string; direction?: Direction }) => {
      const { error } = await (supabase.rpc as any)("endpoint_microseg_enforce", {
        p_endpoint_id: endpointId, p_direction: direction,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["endpoint-microseg", vars.endpointId, vars.direction] });
      queryClient.invalidateQueries({ queryKey: ["microseg-rules"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({
        title: `${vars.direction === "outbound" ? "Outbound" : "Inbound"} enforcement applied`,
        description: "Block rules created for every observed (port, protocol). The agent will install them on next policy pass (~15 min).",
      });
    },
    onError: (e: Error) => toast({ title: "Failed to enforce", description: e.message, variant: "destructive" }),
  });
}

// Unmatched (unobserved) traffic ---------------------------------------------

export interface UnmatchedTrafficRow {
  local_port: number;
  protocol: string;
  hits_24h: number;
  hits_7d: number;
  unique_sources_24h: number;
  unique_sources_7d: number;
  unique_endpoints_7d: number;
  last_seen: string | null;
  sample_service_name: string | null;
  top_sources: SourceCount[];
}

export function useMicrosegUnmatchedTraffic() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;
  return useQuery({
    queryKey: ["microseg-unmatched", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_microseg_unmatched_traffic", {
        p_org_id: orgId, p_top_limit: 100,
      });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        hits_24h: Number(r.hits_24h),
        hits_7d: Number(r.hits_7d),
        unique_sources_24h: Number(r.unique_sources_24h),
        unique_sources_7d: Number(r.unique_sources_7d),
        unique_endpoints_7d: Number(r.unique_endpoints_7d),
      })) as UnmatchedTrafficRow[];
    },
  });
}

/**
 * Promote an observed unmatched (port, protocol) into a tracked rule. We
 * attach the new rule to the same policy and endpoint_group as the first
 * existing rule in the dashboard (so it gets pushed to the same endpoints).
 * If no existing rule exists yet, the caller has to pick a group first --
 * this returns an error in that case.
 */
export function usePromoteToRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (opts: {
      port: number;
      protocol: string;
      serviceName: string;
      policyId?: string;
      endpointGroupId?: string;
    }) => {
      let { policyId, endpointGroupId } = opts;
      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error("No organization selected.");

      // Resolve policy/group from an existing rule in this org if not provided.
      if (!policyId || !endpointGroupId) {
        const { data: anyRule, error } = await supabase
          .from("firewall_service_rules")
          .select("policy_id, endpoint_group_id, firewall_policies!inner(organization_id)")
          .eq("firewall_policies.organization_id", orgId)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!anyRule) throw new Error("Create at least one rule manually first so we know which policy + group to attach to.");
        policyId        = policyId ?? (anyRule as any).policy_id;
        endpointGroupId = endpointGroupId ?? (anyRule as any).endpoint_group_id;
      }

      const { error: insErr } = await supabase
        .from("firewall_service_rules")
        .insert({
          service_name:      opts.serviceName,
          port:              String(opts.port),
          protocol:          opts.protocol.toLowerCase(),
          action:            "block",
          mode:              "audit",
          enabled:           true,
          policy_id:         policyId,
          endpoint_group_id: endpointGroupId,
          audit_started_at:  new Date().toISOString(),
        });
      if (insErr) throw insErr;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["microseg-rules"] });
      queryClient.invalidateQueries({ queryKey: ["microseg-unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({
        title: "Rule created",
        description: `${vars.serviceName} (${vars.protocol.toUpperCase()}/${vars.port}) is now being audited.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to create rule", description: e.message, variant: "destructive" });
    },
  });
}

/** Bulk-promote every row in the unmatched-traffic list into rules. */
export function usePromoteAllUnmatched() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentOrganization } = useTenant();
  return useMutation({
    mutationFn: async (rows: UnmatchedTrafficRow[]) => {
      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error("No organization selected.");
      if (rows.length === 0) return { created: 0 };

      // Resolve policy/group ONCE from an existing rule.
      const { data: anyRule, error } = await supabase
        .from("firewall_service_rules")
        .select("policy_id, endpoint_group_id, firewall_policies!inner(organization_id)")
        .eq("firewall_policies.organization_id", orgId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!anyRule) throw new Error("Create at least one rule manually first so we know which policy + group to attach to.");
      const policyId        = (anyRule as any).policy_id;
      const endpointGroupId = (anyRule as any).endpoint_group_id;

      const toInsert = rows.map((r) => ({
        service_name:      r.sample_service_name ?? `Port-${r.local_port}`,
        port:              String(r.local_port),
        protocol:          (r.protocol || "tcp").toLowerCase(),
        action:            "block",
        mode:              "audit",
        enabled:           true,
        policy_id:         policyId,
        endpoint_group_id: endpointGroupId,
        audit_started_at:  new Date().toISOString(),
      }));
      const { error: insErr } = await supabase
        .from("firewall_service_rules").insert(toInsert);
      if (insErr) throw insErr;
      return { created: toInsert.length };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["microseg-rules"] });
      queryClient.invalidateQueries({ queryKey: ["microseg-unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
      toast({
        title: "Rule set built",
        description: `${res.created} new audit-mode rules created from observed traffic.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to promote", description: e.message, variant: "destructive" });
    },
  });
}

// Per-rule audit controls -----------------------------------------------------

function invalidateRuleQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["microseg-rules"] });
  queryClient.invalidateQueries({ queryKey: ["firewall-service-rules"] });
}

/** Start (or resume) auditing a rule and reset its learning window. */
export function useStartAuditRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ ruleId }: { ruleId: string }) => {
      const { error } = await supabase
        .from("firewall_service_rules")
        .update({
          mode: "audit",
          enabled: true,
          audit_started_at: new Date().toISOString(),
        })
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateRuleQueries(queryClient);
      toast({
        title: "Audit started",
        description: "Rule is observing inbound traffic. Hits counted from now.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to start audit", description: e.message, variant: "destructive" });
    },
  });
}

/** Pause the rule entirely -- no observation, no enforcement. */
export function useStopAuditRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ ruleId }: { ruleId: string }) => {
      const { error } = await supabase
        .from("firewall_service_rules")
        .update({ enabled: false })
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateRuleQueries(queryClient);
      toast({
        title: "Audit stopped",
        description: "Rule is paused. No observation or enforcement until you start it again.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to stop audit", description: e.message, variant: "destructive" });
    },
  });
}

/** Reset the audit baseline -- counters drop to 0 and recount from now. Mode unchanged. */
export function useRestartAuditRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ ruleId }: { ruleId: string }) => {
      const { error } = await supabase
        .from("firewall_service_rules")
        .update({
          audit_started_at: new Date().toISOString(),
          enabled: true,
        })
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateRuleQueries(queryClient);
      toast({
        title: "Audit restarted",
        description: "Counters reset. New hits will accumulate from now.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to restart audit", description: e.message, variant: "destructive" });
    },
  });
}
