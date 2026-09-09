import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Tile shapes mirror the server-side public.radar_tile_* return values.
// Tiles below the privacy floor come back as { suppressed: true, message }.

export type SuppressedTile = { suppressed: true; message: string };

export interface ThreatsBlockedTile {
  window: string;
  total: number;
  blocked: number;
  by_severity: Record<string, { total: number; blocked: number }>;
  tenants: number;
}

export interface MalwareFamiliesTile {
  window: string;
  items: { family: string; hits: number; tenants: number }[];
  tenants: number;
}

export interface TopCvesTile {
  items: { cve: string; endpoints: number; tenants: number; cvss: number; kev: boolean }[];
  tenants: number;
}

export interface EolExposureTile {
  items: { os: string; share: number; eol: boolean; tenants: number }[];
  tenants: number;
}

export interface BruteForcePortsTile {
  window: string;
  items: { port: string; service: string | null; attempts: number; tenants: number }[];
}

export interface AttackOriginsTile {
  window: string;
  items: { country: string; attempts: number; tenants: number }[];
}

export interface PhishingThemesTile {
  window: string;
  items: { theme: string; detections: number; tenants: number }[];
  unavailable?: boolean;
}

export interface WpBruteForceTile {
  window: string;
  items: { date: string; count: number }[];
}

export interface AiDigestTile {
  headline: string;
  bullets: { text: string; source: "acsc" | "cisa" | "abuse_ch" | "ransomware_live" | "fleet" }[];
  sources: {
    acsc: number;
    cisa_kev_count: number;
    threatfox: number;
    urlhaus: number;
    ransomware: number;
  };
}

type Tile<T> = T | SuppressedTile;

export interface RadarPayload {
  tiles: {
    threats_blocked_week?:  Tile<ThreatsBlockedTile>;
    top_malware_families?:  Tile<MalwareFamiliesTile>;
    top_cves?:              Tile<TopCvesTile>;
    eol_exposure?:          Tile<EolExposureTile>;
    brute_force_ports?:     Tile<BruteForcePortsTile>;
    attack_origins?:        Tile<AttackOriginsTile>;
    phishing_themes?:       Tile<PhishingThemesTile>;
    wp_bruteforce_trend?:   Tile<WpBruteForceTile>;
    ai_weekly_digest?:      Tile<AiDigestTile>;
  };
  external: {
    cisa_kev?: { source: string; fetched_at: string; total_known_exploited: number } | null;
    threatfox_24h?: {
      source: string;
      fetched_at: string;
      sample: { malware: string; threat_type: string; ioc: string; first_seen: string }[];
    } | null;
    urlhaus?: {
      source: string;
      fetched_at: string;
      sample: { dateadded: string; url: string; status: string; threat: string; tags: string }[];
    } | null;
    feodo?: {
      source: string;
      fetched_at: string;
      sample: { first_seen: string; ip: string; port: string; status: string; malware: string }[];
    } | null;
    acsc_alerts?: {
      source: string;
      fetched_at: string;
      sample: { title: string; link: string; published: string; summary: string; severity: string }[];
    } | null;
    ransomware_live?: {
      source: string;
      fetched_at: string;
      total_last7: number;
      sample: { group: string; victims: number; latest: string }[];
    } | null;
  };
  meta: { generated_at: string; snapshot_oldest: string | null };
}

export function isSuppressed<T>(tile: Tile<T> | undefined): tile is SuppressedTile {
  return !!tile && typeof tile === "object" && (tile as SuppressedTile).suppressed === true;
}

export function useRadar() {
  return useQuery({
    queryKey: ["radar-public"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<RadarPayload>("radar-public", { method: "GET" });
      if (error) throw error;
      if (!data) throw new Error("Empty radar response");
      return data;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
