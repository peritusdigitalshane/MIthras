import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

// PoC rec #9: ILIKE wildcards in user input previously matched everything --
// typing '%' returned the first 100 rows of every queried table, looking like
// a real hit. Escape \, %, _ so the user's literal characters are matched
// against literal characters in the DB. The leading/trailing '%' wrappers we
// add to build "contains" semantics stay untouched.
function escapeLikePattern(value: string): string {
  return (value ?? "").replace(/[\\%_]/g, "\\$&");
}

// Types for threat hunting
export type IocType = "file_hash" | "file_path" | "file_name" | "process_name";
export type HashType = "md5" | "sha1" | "sha256";
export type Severity = "low" | "medium" | "high" | "critical";
export type IocSource = "manual" | "virustotal" | "alienvault" | "misp" | "other";
export type HuntStatus = "pending" | "running" | "completed" | "failed";
export type HuntType = "ioc_sweep" | "quick_search" | "pattern_search";
export type MatchSource = "discovered_apps" | "threats" | "event_logs";

export interface VTEnrichmentData {
  detection_ratio: string;
  malicious_count: number;
  total_engines: number;
  threat_names: string[];
  file_type: string | null;
  file_size: number | null;
  meaningful_name: string | null;
  first_submission_date: string | null;
  last_analysis_date: string | null;
  sha256: string | null;
  sha1: string | null;
  md5: string | null;
  raw_stats: {
    malicious: number;
    suspicious: number;
    harmless: number;
    undetected: number;
    timeout: number;
  };
}

export interface Ioc {
  id: string;
  organization_id: string;
  ioc_type: IocType;
  value: string;
  hash_type: HashType | null;
  threat_name: string | null;
  severity: Severity;
  source: IocSource;
  description: string | null;
  is_active: boolean;
  tags: string[];
  created_at: string;
  created_by: string | null;
  // VT enrichment fields - use unknown for JSON compatibility
  vt_enrichment: unknown;
  vt_enriched_at: string | null;
  vt_detection_ratio: string | null;
}

// Type for creating IOCs (without VT fields which are set server-side)
export type IocCreateInput = Omit<Ioc, "id" | "created_at" | "organization_id" | "vt_enrichment" | "vt_enriched_at" | "vt_detection_ratio">;

export interface HuntJob {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: HuntStatus;
  hunt_type: HuntType;
  parameters: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  total_endpoints: number | null;
  matches_found: number | null;
  created_by: string | null;
  created_at: string;
}

export interface HuntMatch {
  id: string;
  hunt_job_id: string;
  ioc_id: string | null;
  endpoint_id: string;
  match_source: MatchSource;
  matched_value: string;
  context: Record<string, unknown>;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  endpoint?: {
    hostname: string;
    is_online: boolean;
  };
}

export interface QuickSearchResult {
  source: MatchSource;
  endpoint_id: string;
  endpoint_hostname: string;
  matched_value: string;
  context: Record<string, unknown>;
}

// Auto-detect IOC type from value
export function detectIocType(value: string): { type: IocType; hashType?: HashType } {
  const trimmed = value.trim().toLowerCase();
  
  // SHA256: 64 hex characters
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return { type: "file_hash", hashType: "sha256" };
  }
  
  // SHA1: 40 hex characters
  if (/^[a-f0-9]{40}$/i.test(trimmed)) {
    return { type: "file_hash", hashType: "sha1" };
  }
  
  // MD5: 32 hex characters
  if (/^[a-f0-9]{32}$/i.test(trimmed)) {
    return { type: "file_hash", hashType: "md5" };
  }
  
  // File path: contains backslash or forward slash with extension
  if (/[\\\/]/.test(value) && /\.\w+$/.test(value)) {
    return { type: "file_path" };
  }
  
  // File name: has extension but no path separators
  if (/\.\w+$/.test(value) && !/[\\\/]/.test(value)) {
    return { type: "file_name" };
  }
  
  // Default to process name
  return { type: "process_name" };
}

// Hook: IOC Library CRUD
export function useIocLibrary() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgId = currentOrganization?.id;

  const query = useQuery({
    queryKey: ["ioc_library", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("ioc_library")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as Ioc[];
    },
    enabled: !!orgId,
  });

  const createIoc = useMutation({
    mutationFn: async (ioc: IocCreateInput) => {
      if (!orgId) throw new Error("No organization selected");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertData: any = { ...ioc, organization_id: orgId };
      const { data, error } = await supabase
        .from("ioc_library")
        .insert(insertData)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ioc_library", orgId] });
      toast({ title: "IOC added successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to add IOC", description: error.message, variant: "destructive" });
    },
  });

  const updateIoc = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<IocCreateInput> & { id: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = updates;
      const { data, error } = await supabase
        .from("ioc_library")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ioc_library", orgId] });
      toast({ title: "IOC updated successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to update IOC", description: error.message, variant: "destructive" });
    },
  });

  const deleteIoc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ioc_library")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ioc_library", orgId] });
      toast({ title: "IOC deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete IOC", description: error.message, variant: "destructive" });
    },
  });

  const bulkCreateIocs = useMutation({
    mutationFn: async (iocs: IocCreateInput[]) => {
      if (!orgId) throw new Error("No organization selected");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertData: any[] = iocs.map(ioc => ({ ...ioc, organization_id: orgId }));
      const { data, error } = await supabase
        .from("ioc_library")
        .insert(insertData)
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ioc_library", orgId] });
      toast({ title: `${data.length} IOCs imported successfully` });
    },
    onError: (error) => {
      toast({ title: "Failed to import IOCs", description: error.message, variant: "destructive" });
    },
  });

  return {
    iocs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createIoc,
    updateIoc,
    deleteIoc,
    bulkCreateIocs,
  };
}

// Hook: Hunt Jobs
export function useHuntJobs() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgId = currentOrganization?.id;

  const query = useQuery({
    queryKey: ["hunt_jobs", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("hunt_jobs")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as HuntJob[];
    },
    enabled: !!orgId,
  });

  const createHuntJob = useMutation({
    mutationFn: async (job: { name: string; description?: string | null; hunt_type: string; parameters?: Record<string, unknown>; created_by?: string | null }) => {
      if (!orgId) throw new Error("No organization selected");
      const insertData = {
        name: job.name,
        description: job.description ?? null,
        hunt_type: job.hunt_type,
        parameters: JSON.parse(JSON.stringify(job.parameters ?? {})),
        organization_id: orgId,
        created_by: job.created_by ?? null,
      };
      const { data, error } = await supabase
        .from("hunt_jobs")
        .insert(insertData)
        .select()
        .single();
      
      if (error) throw error;
      return data as HuntJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hunt_jobs", orgId] });
      toast({ title: "Hunt job created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create hunt job", description: error.message, variant: "destructive" });
    },
  });

  const updateHuntJob = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; started_at?: string; completed_at?: string; total_endpoints?: number; matches_found?: number }) => {
      const { data, error } = await supabase
        .from("hunt_jobs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hunt_jobs", orgId] });
    },
  });

  const deleteHuntJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hunt_jobs")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hunt_jobs", orgId] });
      toast({ title: "Hunt job deleted" });
    },
  });

  return {
    huntJobs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createHuntJob,
    updateHuntJob,
    deleteHuntJob,
  };
}

// Hook: Hunt Matches
export function useHuntMatches(huntJobId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["hunt_matches", huntJobId],
    queryFn: async () => {
      if (!huntJobId) return [];
      const { data, error } = await supabase
        .from("hunt_matches")
        .select(`
          *,
          endpoint:endpoints(hostname, is_online)
        `)
        .eq("hunt_job_id", huntJobId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as HuntMatch[];
    },
    enabled: !!huntJobId,
  });

  const markReviewed = useMutation({
    mutationFn: async ({ id, reviewed }: { id: string; reviewed: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hunt_matches")
        .update({
          reviewed,
          reviewed_by: reviewed ? user?.id : null,
          reviewed_at: reviewed ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hunt_matches", huntJobId] });
      toast({ title: "Match updated" });
    },
  });

  return {
    matches: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    markReviewed,
  };
}

// Hook: Quick Search (instant IOC lookup)
export function useQuickSearch() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (searchValue: string): Promise<QuickSearchResult[]> => {
      if (!orgId) throw new Error("No organization selected");
      
      const results: QuickSearchResult[] = [];
      const normalizedValue = searchValue.trim().toLowerCase();
      const detection = detectIocType(searchValue);
      const escapedSearch = escapeLikePattern(searchValue);
      const escapedNormalized = escapeLikePattern(normalizedValue);

      // Search discovered apps
      if (detection.type === "file_hash" || detection.type === "file_path" || detection.type === "file_name") {
        let query = supabase
          .from("wdac_discovered_apps")
          .select("id, endpoint_id, file_hash, file_path, file_name, endpoints!inner(hostname)")
          .eq("organization_id", orgId);

        if (detection.type === "file_hash") {
          query = query.ilike("file_hash", escapedNormalized);
        } else if (detection.type === "file_path") {
          query = query.ilike("file_path", `%${escapedSearch}%`);
        } else {
          query = query.ilike("file_name", `%${escapedSearch}%`);
        }

        const { data } = await query.limit(100);
        if (data) {
          results.push(...data.map((app: Record<string, unknown>) => ({
            source: "discovered_apps" as MatchSource,
            endpoint_id: app.endpoint_id as string,
            endpoint_hostname: (app.endpoints as Record<string, string>)?.hostname ?? "Unknown",
            matched_value: detection.type === "file_hash" 
              ? (app.file_hash as string) 
              : detection.type === "file_path" 
                ? (app.file_path as string) 
                : (app.file_name as string),
            context: { file_path: app.file_path, file_name: app.file_name, file_hash: app.file_hash },
          })));
        }
      }

      // Search endpoint_threats by name (file_name / process_name / generic) or
      // hash inside the Defender raw payload. Closes PoC rec #6 -- the page
      // advertises threats as a source, but the previous implementation never
      // queried this table. ilike on a jsonb-as-text gives a coarse but useful
      // match on hashes embedded in resources / additional_actions.
      if (detection.type === "file_hash" || detection.type === "file_name" || detection.type === "process_name" || detection.type === "file_path") {
        const term = `%${escapedSearch}%`;
        let q = supabase
          .from("endpoint_threats")
          .select("id, endpoint_id, threat_name, severity, status, category, initial_detection_time, raw_data, endpoints!inner(hostname, organization_id)")
          .eq("endpoints.organization_id", orgId);

        if (detection.type === "file_hash") {
          // Hash matches: raw_data jsonb-as-text contains the hash. Use a single
          // ilike on the text cast so we don't need to know which key the
          // Defender ETW payload nested it under.
          q = q.filter("raw_data", "ilike", term);
        } else {
          // For names/paths/processes, threat_name is the primary signal;
          // resources/raw_data also frequently contains paths.
          q = q.or(`threat_name.ilike.${term},raw_data.ilike.${term}`);
        }

        const { data } = await q.limit(100);
        if (data) {
          results.push(...data.map((t: Record<string, unknown>) => ({
            source: "threats" as MatchSource,
            endpoint_id: t.endpoint_id as string,
            endpoint_hostname: (t.endpoints as Record<string, string>)?.hostname ?? "Unknown",
            matched_value: detection.type === "file_hash" ? searchValue : (t.threat_name as string),
            context: {
              threat_name: t.threat_name,
              severity: t.severity,
              status: t.status,
              category: t.category,
              initial_detection_time: t.initial_detection_time,
            },
          })));
        }
      }

      // Search event logs for path/name/process matches
      if (detection.type === "file_path" || detection.type === "file_name" || detection.type === "process_name") {
        const { data } = await supabase
          .from("endpoint_event_logs")
          .select("id, endpoint_id, message, event_time, log_source, event_id, raw_data, endpoints!inner(hostname, organization_id)")
          .eq("endpoints.organization_id", orgId)
          .ilike("message", `%${escapedSearch}%`)
          .limit(100);

        if (data) {
          results.push(...data.map((log: Record<string, unknown>) => ({
            source: "event_logs" as MatchSource,
            endpoint_id: log.endpoint_id as string,
            endpoint_hostname: (log.endpoints as Record<string, string>)?.hostname ?? "Unknown",
            matched_value: searchValue,
            context: { 
              message: log.message, 
              event_time: log.event_time,
              log_source: log.log_source,
              event_id: log.event_id,
              raw_data: log.raw_data,
            },
          })));
        }
      }

      return results;
    },
  });
}

// Hook: Execute a full hunt job
export function useExecuteHunt() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async ({ jobId, iocIds }: { jobId: string; iocIds: string[] }) => {
      if (!orgId) throw new Error("No organization selected");

      // Update job status to running
      await supabase
        .from("hunt_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId);

      // Get IOCs to search for
      const { data: iocs } = await supabase
        .from("ioc_library")
        .select("*")
        .in("id", iocIds);

      if (!iocs?.length) {
        throw new Error("No IOCs found to search");
      }

      let totalMatches = 0;
      const endpointIds = new Set<string>();

      for (const ioc of iocs) {
        const detection = detectIocType(ioc.value);
        const normalizedValue = ioc.value.trim().toLowerCase();
        const escapedNormalized = escapeLikePattern(normalizedValue);
        const escapedIocValue = escapeLikePattern(ioc.value);

        // Search discovered apps for hashes
        if (detection.type === "file_hash") {
          const { data: apps } = await supabase
            .from("wdac_discovered_apps")
            .select("endpoint_id, file_hash, file_path, file_name")
            .eq("organization_id", orgId)
            .ilike("file_hash", escapedNormalized);

          if (apps?.length) {
            for (const app of apps) {
              endpointIds.add(app.endpoint_id);
              await supabase.from("hunt_matches").insert({
                hunt_job_id: jobId,
                ioc_id: ioc.id,
                endpoint_id: app.endpoint_id,
                match_source: "discovered_apps",
                matched_value: app.file_hash ?? "",
                context: { file_path: app.file_path, file_name: app.file_name },
              });
              totalMatches++;
            }
          }
        }

        // Search for file paths/names in discovered apps
        if (detection.type === "file_path" || detection.type === "file_name") {
          const column = detection.type === "file_path" ? "file_path" : "file_name";
          const { data: apps } = await supabase
            .from("wdac_discovered_apps")
            .select("endpoint_id, file_hash, file_path, file_name")
            .eq("organization_id", orgId)
            .ilike(column, `%${escapedIocValue}%`);

          if (apps?.length) {
            for (const app of apps) {
              endpointIds.add(app.endpoint_id);
              await supabase.from("hunt_matches").insert({
                hunt_job_id: jobId,
                ioc_id: ioc.id,
                endpoint_id: app.endpoint_id,
                match_source: "discovered_apps",
                matched_value: (app as Record<string, unknown>)[column] as string ?? "",
                context: { file_path: app.file_path, file_name: app.file_name, file_hash: app.file_hash },
              });
              totalMatches++;
            }
          }
        }

        // Search event logs
        if (detection.type === "file_path" || detection.type === "file_name" || detection.type === "process_name") {
          const { data: logs } = await supabase
            .from("endpoint_event_logs")
            .select("endpoint_id, message, event_time, endpoints!inner(organization_id)")
            .eq("endpoints.organization_id", orgId)
            .ilike("message", `%${escapedIocValue}%`)
            .limit(500);

          if (logs?.length) {
            for (const log of logs) {
              endpointIds.add(log.endpoint_id);
              await supabase.from("hunt_matches").insert({
                hunt_job_id: jobId,
                ioc_id: ioc.id,
                endpoint_id: log.endpoint_id,
                match_source: "event_logs",
                matched_value: ioc.value,
                context: { message: log.message, event_time: log.event_time },
              });
              totalMatches++;
            }
          }
        }
      }

      // Update job as completed
      await supabase
        .from("hunt_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          total_endpoints: endpointIds.size,
          matches_found: totalMatches,
        })
        .eq("id", jobId);

      return { totalMatches, totalEndpoints: endpointIds.size };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["hunt_jobs", orgId] });
      toast({
        title: "Hunt completed",
        description: `Found ${data.totalMatches} matches across ${data.totalEndpoints} endpoints`,
      });
    },
    onError: async (error, { jobId }) => {
      await supabase
        .from("hunt_jobs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      toast({ title: "Hunt failed", description: error.message, variant: "destructive" });
    },
  });
}

// Hook: VirusTotal Lookup
export function useVirusTotalLookup() {
  const { currentOrganization } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async ({ hash, iocId }: { hash: string; iocId?: string }): Promise<VTEnrichmentData> => {
      const { data, error } = await supabase.functions.invoke("virustotal-lookup", {
        body: { action: "lookup", hash, iocId },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Lookup failed");
      }

      return data.enrichment as VTEnrichmentData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ioc_library", orgId] });
      const status = data.malicious_count === 0 
        ? "Clean - no threats detected" 
        : `${data.malicious_count} engines detected threats`;
      toast({
        title: "VirusTotal lookup complete",
        description: status,
      });
    },
    onError: (error) => {
      toast({
        title: "VirusTotal lookup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
