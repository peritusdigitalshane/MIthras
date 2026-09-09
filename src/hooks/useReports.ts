import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDashboardStats } from "./useDashboardData";
import { Json } from "@/integrations/supabase/types";

export type ReportType = "monthly_security" | "cyber_insurance";

export interface SecurityReport {
  id: string;
  organization_id: string;
  report_type: ReportType;
  report_title: string;
  report_period_start: string;
  report_period_end: string;
  generated_by: string | null;
  generated_at: string;
  report_data: ReportData;
  section_visibility: SectionVisibility;
  pdf_storage_path: string | null;
  created_at: string;
}

export interface Essential8Strategy {
  name: string;
  maturityLevel: 0 | 1 | 2 | 3;
  coverage: number;
  description: string;
  gaps: string[];
}

export interface Essential8EndpointAlignment {
  endpointId: string;
  hostname: string;
  isOnline: boolean;
  appControl: boolean;
  patchApps: boolean;
  officeMacros: boolean;
  appHardening: boolean;
  adminPrivileges: boolean;
  patchOS: boolean;
  overallMaturity: 0 | 1 | 2 | 3;
  alignedCount: number;
}

export interface ReportData {
  // Executive Summary
  organizationName?: string;
  reportPeriod?: string;
  securityScore?: number;
  totalEndpoints?: number;
  protectedEndpoints?: number;
  compliancePercentage?: number;
  
  // Threat Summary
  totalThreats?: number;
  criticalThreats?: number;
  highThreats?: number;
  mediumThreats?: number;
  lowThreats?: number;
  resolvedThreats?: number;
  activeThreats?: number;
  
  // Compliance Details
  realtimeProtection?: number;
  antivirusEnabled?: number;
  signatureCompliance?: number;
  behaviorMonitoring?: number;
  ioavProtection?: number;
  policyAssigned?: number;
  
  // Cyber Insurance specific
  securityControls?: SecurityControl[];
  recommendations?: string[];

  // Essential 8
  essential8?: Essential8Strategy[];
  essential8OverallMaturity?: number;
  essential8Endpoints?: Essential8EndpointAlignment[];
}

export interface SecurityControl {
  name: string;
  status: "implemented" | "partial" | "not_implemented";
  coverage: number;
  description: string;
}

export interface SectionVisibility {
  executiveSummary?: boolean;
  securityScore?: boolean;
  threatSummary?: boolean;
  threatDetails?: boolean;
  complianceOverview?: boolean;
  complianceDetails?: boolean;
  endpointInventory?: boolean;
  recommendations?: boolean;
  securityControls?: boolean;
  coverageSummary?: boolean;
  essential8?: boolean;
}

const defaultMonthlyVisibility: SectionVisibility = {
  executiveSummary: true,
  securityScore: true,
  threatSummary: true,
  threatDetails: true,
  complianceOverview: true,
  complianceDetails: true,
  endpointInventory: true,
  recommendations: true,
  essential8: true,
};

const defaultInsuranceVisibility: SectionVisibility = {
  executiveSummary: true,
  securityScore: true,
  securityControls: true,
  coverageSummary: true,
  complianceOverview: true,
  threatSummary: true,
  recommendations: true,
  essential8: true,
};

export function useReports() {
  const { currentOrganization } = useTenant();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ["security_reports", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("security_reports")
        .select("*")
        .eq("organization_id", orgId!)
        .order("generated_at", { ascending: false });

      if (error) throw error;
      return data.map(r => ({
        ...r,
        report_data: r.report_data as unknown as ReportData,
        section_visibility: r.section_visibility as unknown as SectionVisibility,
      })) as SecurityReport[];
    },
  });
}

export function useGenerateReportData() {
  const { 
    securityScore, 
    totalEndpoints, 
    protectedCount, 
    compliancePercentage,
    activeThreats,
    threats,
    statuses,
    endpoints,
  } = useDashboardStats();
  const { currentOrganization } = useTenant();

  const generateReportData = (reportType: ReportType): ReportData => {
    const statusCount = statuses?.length || 1;
    
    // Calculate compliance metrics
    const realtimeProtection = Math.round((statuses?.filter(s => s.realtime_protection_enabled).length || 0) / statusCount * 100);
    const antivirusEnabled = Math.round((statuses?.filter(s => s.antivirus_enabled).length || 0) / statusCount * 100);
    const signatureCompliance = Math.round((statuses?.filter(s => s.antivirus_signature_age !== null && s.antivirus_signature_age <= 1).length || 0) / statusCount * 100);
    const behaviorMonitoring = Math.round((statuses?.filter(s => s.behavior_monitor_enabled).length || 0) / statusCount * 100);
    const ioavProtection = Math.round((statuses?.filter(s => s.ioav_protection_enabled).length || 0) / statusCount * 100);
    const policyAssigned = Math.round((endpoints?.filter(e => e.policy_id !== null).length || 0) / (totalEndpoints || 1) * 100);

    // Threat breakdown
    const resolvedStatuses = ["resolved", "removed", "blocked"];
    const resolvedThreats = threats?.filter(t => resolvedStatuses.includes(t.status.toLowerCase())).length || 0;
    const criticalThreats = threats?.filter(t => t.severity.toLowerCase() === "critical" || t.severity.toLowerCase() === "severe").length || 0;
    const highThreats = threats?.filter(t => t.severity.toLowerCase() === "high").length || 0;
    const mediumThreats = threats?.filter(t => t.severity.toLowerCase() === "medium" || t.severity.toLowerCase() === "moderate").length || 0;
    const lowThreats = threats?.filter(t => t.severity.toLowerCase() === "low").length || 0;

    const baseData: ReportData = {
      organizationName: currentOrganization?.name || "Organization",
      securityScore,
      totalEndpoints,
      protectedEndpoints: protectedCount,
      compliancePercentage,
      totalThreats: threats?.length || 0,
      criticalThreats,
      highThreats,
      mediumThreats,
      lowThreats,
      resolvedThreats,
      activeThreats,
      realtimeProtection,
      antivirusEnabled,
      signatureCompliance,
      behaviorMonitoring,
      ioavProtection,
      policyAssigned,
    };

    if (reportType === "cyber_insurance") {
      baseData.securityControls = [
        {
          name: "Endpoint Detection & Response (EDR)",
          status: realtimeProtection >= 90 ? "implemented" : realtimeProtection >= 50 ? "partial" : "not_implemented",
          coverage: realtimeProtection,
          description: "Microsoft Defender real-time protection enabled across fleet",
        },
        {
          name: "Antivirus Protection",
          status: antivirusEnabled >= 90 ? "implemented" : antivirusEnabled >= 50 ? "partial" : "not_implemented",
          coverage: antivirusEnabled,
          description: "Active antivirus scanning on all endpoints",
        },
        {
          name: "Signature Updates",
          status: signatureCompliance >= 90 ? "implemented" : signatureCompliance >= 50 ? "partial" : "not_implemented",
          coverage: signatureCompliance,
          description: "Virus definitions updated within 24 hours",
        },
        {
          name: "Behavior Monitoring",
          status: behaviorMonitoring >= 90 ? "implemented" : behaviorMonitoring >= 50 ? "partial" : "not_implemented",
          coverage: behaviorMonitoring,
          description: "Suspicious activity pattern detection enabled",
        },
        {
          name: "Download Protection (IOAV)",
          status: ioavProtection >= 90 ? "implemented" : ioavProtection >= 50 ? "partial" : "not_implemented",
          coverage: ioavProtection,
          description: "Scanning of files downloaded from the internet",
        },
        {
          name: "Centralized Policy Management",
          status: policyAssigned >= 90 ? "implemented" : policyAssigned >= 50 ? "partial" : "not_implemented",
          coverage: policyAssigned,
          description: "Security policies centrally managed and enforced",
        },
      ];
    }

    // Essential 8 Maturity Assessment (ACSC Framework)
    const calcMaturity = (coverage: number): 0 | 1 | 2 | 3 => {
      if (coverage >= 95) return 3;
      if (coverage >= 80) return 2;
      if (coverage >= 50) return 1;
      return 0;
    };

    // E8 Strategy 1: Application Control (WDAC policies in enforced mode)
    const wdacCoverage = Math.round((endpoints?.filter(e => (e as any).wdac_policy_id !== null).length || 0) / (totalEndpoints || 1) * 100);
    const appControlGaps: string[] = [];
    if (wdacCoverage < 50) appControlGaps.push("Deploy WDAC policies to endpoints via Security → Application Control");
    if (wdacCoverage < 95) appControlGaps.push("Assign WDAC rule sets to all endpoint groups and set mode to 'Enforced'");
    if (wdacCoverage >= 95) appControlGaps.push("Verify all WDAC rule sets are in 'Enforced' mode (not Audit) for Level 3");

    // E8 Strategy 2: Patch Applications (Windows Update policies + signature currency)
    // Level 3 requires patching within 48 hours for critical vulns
    const wuPolicyCoverage = Math.round((endpoints?.filter(e => (e as any).windows_update_policy_id !== null).length || 0) / (totalEndpoints || 1) * 100);
    const patchAppCoverage = Math.round((wuPolicyCoverage * 0.6) + (signatureCompliance * 0.4));
    const patchAppGaps: string[] = [];
    if (wuPolicyCoverage < 80) patchAppGaps.push("Assign Windows Update policies to all endpoints via Security → Windows Update");
    if (signatureCompliance < 80) patchAppGaps.push("Reduce signature update interval to 4 hours or less in Defender policies");
    if (wuPolicyCoverage >= 80 && signatureCompliance >= 80) patchAppGaps.push("Set quality update deferral to 0 days in Windows Update policies for Level 3");

    // E8 Strategy 3: Configure Microsoft Office Macro Settings (ASR macro rules)
    // Requires ASR rule asr_block_office_macro_win32 + asr_block_office_child_process + asr_block_office_executable_content enabled
    const defenderPolicyCoverage = policyAssigned;
    const macroCoverage = defenderPolicyCoverage;
    const macroGaps: string[] = [];
    if (defenderPolicyCoverage < 50) macroGaps.push("Assign Defender policies with ASR rules enabled to all endpoints");
    if (defenderPolicyCoverage < 95) macroGaps.push("Ensure all endpoints have a Defender policy with macro ASR rules set to 'Block'");
    macroGaps.push("Verify ASR rules 'Block Win32 API calls from Office macros', 'Block Office child processes', and 'Block Office executable content' are set to Enabled (not Audit) in Policies → Defender");

    // E8 Strategy 4: User Application Hardening (network protection, exploit protection, script scanning, IOAV)
    const hardeningMetrics = [
      realtimeProtection,
      behaviorMonitoring,
      ioavProtection,
      policyAssigned, // proxy for network protection & exploit protection being configured
    ];
    const appHardeningCoverage = Math.round(hardeningMetrics.reduce((a, b) => a + b, 0) / hardeningMetrics.length);
    const appHardeningGaps: string[] = [];
    if (ioavProtection < 80) appHardeningGaps.push("Enable IOAV (download) protection across all endpoints");
    if (policyAssigned < 80) appHardeningGaps.push("Assign Defender policies with Network Protection and Exploit Protection enabled");
    appHardeningGaps.push("Ensure 'Network Protection' is set to Block mode and 'Exploit Protection' is enabled in Policies → Defender → Advanced Settings");

    // E8 Strategy 5: Restrict Administrative Privileges (UAC policies)
    const uacCoverage = Math.round((endpoints?.filter(e => (e as any).uac_policy_id !== null).length || 0) / (totalEndpoints || 1) * 100);
    const adminGaps: string[] = [];
    if (uacCoverage < 50) adminGaps.push("Deploy UAC policies to endpoints via Security → UAC Management");
    if (uacCoverage < 95) adminGaps.push("Assign UAC policies to all endpoint groups");
    adminGaps.push("Use the 'Secure' UAC policy template with credential prompts and admin token filtering for Level 3");

    // E8 Strategy 6: Patch Operating Systems (Windows Update policies with 0-day deferral)
    const osPatchCoverage = wuPolicyCoverage;
    const osPatchGaps: string[] = [];
    if (osPatchCoverage < 50) osPatchGaps.push("Create and assign Windows Update policies via Security → Windows Update");
    if (osPatchCoverage < 95) osPatchGaps.push("Ensure all endpoints have a Windows Update policy assigned");
    osPatchGaps.push("Set quality and feature update deferrals to 0 days for Level 3 compliance");

    // E8 Strategy 7: Multi-Factor Authentication
    // Platform supports MFA for console access; Level 3 requires phishing-resistant MFA (FIDO2/WebAuthn)
    const mfaCoverage = policyAssigned >= 90 ? 60 : policyAssigned >= 50 ? 30 : 10;
    const mfaGaps: string[] = [
      "Enable MFA for all platform users via Settings → MFA",
      "Configure phishing-resistant MFA (FIDO2/WebAuthn) at your Identity Provider (e.g., Entra ID) for Level 3",
      "Enforce MFA for all privileged/administrator accounts",
    ];

    // E8 Strategy 8: Regular Backups
    // Outside platform scope - requires external verification
    const backupCoverage = 0;
    const backupGaps: string[] = [
      "Implement regular automated backups using a dedicated backup solution (outside platform scope)",
      "Test backup restoration procedures at least quarterly",
      "Store backups offline or in immutable storage for Level 3",
    ];

    const essential8: Essential8Strategy[] = [
      { name: "Application Control", maturityLevel: calcMaturity(wdacCoverage), coverage: wdacCoverage, description: "Control which applications can execute using WDAC policies in Enforced mode", gaps: appControlGaps },
      { name: "Patch Applications", maturityLevel: calcMaturity(patchAppCoverage), coverage: patchAppCoverage, description: "Keep applications patched via Windows Update policies and up-to-date Defender signatures", gaps: patchAppGaps },
      { name: "Configure MS Office Macros", maturityLevel: calcMaturity(macroCoverage), coverage: macroCoverage, description: "Block Office macros via ASR rules: Block Win32 API calls, Block child processes, Block executable content creation", gaps: macroGaps },
      { name: "User Application Hardening", maturityLevel: calcMaturity(appHardeningCoverage), coverage: appHardeningCoverage, description: "Harden applications with Network Protection (Block mode), Exploit Protection, IOAV scanning, and script scanning", gaps: appHardeningGaps },
      { name: "Restrict Admin Privileges", maturityLevel: calcMaturity(uacCoverage), coverage: uacCoverage, description: "Enforce least-privilege access through UAC policies with credential prompts and admin token filtering", gaps: adminGaps },
      { name: "Patch Operating Systems", maturityLevel: calcMaturity(osPatchCoverage), coverage: osPatchCoverage, description: "Ensure timely OS patching via Windows Update policies with minimal deferral periods", gaps: osPatchGaps },
      { name: "Multi-Factor Authentication", maturityLevel: calcMaturity(mfaCoverage), coverage: mfaCoverage, description: "Require phishing-resistant MFA (FIDO2/WebAuthn) for all users via Identity Provider", gaps: mfaGaps },
      { name: "Regular Backups", maturityLevel: calcMaturity(backupCoverage), coverage: backupCoverage, description: "Regular automated backups with tested restoration and immutable/offline storage", gaps: backupGaps },
    ];

    const overallMaturity = Math.min(...essential8.map(s => s.maturityLevel));

    // Per-endpoint Essential 8 alignment
    const essential8Endpoints: Essential8EndpointAlignment[] = (endpoints || []).map(endpoint => {
      const ep = endpoint as any;
      const status = statuses?.find(s => s.endpoint_id === ep.id);
      
      // App Control: has WDAC policy
      const appControl = !!ep.wdac_policy_id;
      // Patch Apps: has Windows Update policy + current signatures
      const sigCurrent = status?.antivirus_signature_age !== null && status?.antivirus_signature_age !== undefined && status.antivirus_signature_age <= 1;
      const patchApps = !!ep.windows_update_policy_id && sigCurrent;
      // Office Macros: has Defender policy (ASR rules)
      const officeMacros = !!ep.policy_id;
      // App Hardening: realtime + behavior + ioav + defender policy
      const appHardening = !!(status?.realtime_protection_enabled && status?.behavior_monitor_enabled && status?.ioav_protection_enabled && ep.policy_id);
      // Admin Privileges: has UAC policy
      const adminPrivileges = !!ep.uac_policy_id;
      // Patch OS: has Windows Update policy
      const patchOS = !!ep.windows_update_policy_id;

      const checks = [appControl, patchApps, officeMacros, appHardening, adminPrivileges, patchOS];
      const alignedCount = checks.filter(Boolean).length;
      
      // Per-endpoint maturity: 0-2 aligned = L0, 3 = L1, 4-5 = L2, 6 = L3
      const overallMaturity: 0 | 1 | 2 | 3 = alignedCount >= 6 ? 3 : alignedCount >= 4 ? 2 : alignedCount >= 3 ? 1 : 0;

      return {
        endpointId: ep.id,
        hostname: ep.hostname,
        isOnline: ep.is_online,
        appControl,
        patchApps,
        officeMacros,
        appHardening,
        adminPrivileges,
        patchOS,
        overallMaturity,
        alignedCount,
      };
    });

    baseData.essential8 = essential8;
    baseData.essential8OverallMaturity = overallMaturity;
    baseData.essential8Endpoints = essential8Endpoints;

    return baseData;
  };

  const getDefaultVisibility = (reportType: ReportType): SectionVisibility => {
    return reportType === "monthly_security" ? defaultMonthlyVisibility : defaultInsuranceVisibility;
  };

  return { generateReportData, getDefaultVisibility };
}

export function useSaveReport() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useTenant();

  return useMutation({
    mutationFn: async (report: {
      report_type: ReportType;
      report_title: string;
      report_period_start: string;
      report_period_end: string;
      report_data: ReportData;
      section_visibility: SectionVisibility;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from("security_reports")
        .insert({
          organization_id: currentOrganization!.id,
          report_type: report.report_type,
          report_title: report.report_title,
          report_period_start: report.report_period_start,
          report_period_end: report.report_period_end,
          report_data: report.report_data as unknown as Json,
          section_visibility: report.section_visibility as unknown as Json,
          generated_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security_reports"] });
    },
  });
}

export function useDeleteReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await supabase
        .from("security_reports")
        .delete()
        .eq("id", reportId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security_reports"] });
    },
  });
}
