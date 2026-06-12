import { cn } from "@/lib/utils";
import {
  Shield,
  LayoutDashboard,
  Monitor,
  AlertTriangle,
  Settings,
  Users,
  FileText,
  Activity,
  ChevronLeft,
  ChevronDown,
  Download,
  ScrollText,
  Building2,
  FolderOpen,
  Receipt,
  Warehouse,
  Briefcase,
  Sparkles,
  Crosshair,
  Bug,
  Network,
  ClipboardList,
  Router,
  SlidersHorizontal,
  Bell,
  ShieldAlert,
  BookOpen,
  ShieldCheck,
  Cog,
  Eye,
  Wrench,
  Globe,
  BarChart3,
  Cloud,
  Home,
  Coins,
  Target,
  KeyRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useUnacknowledgedAlertCount } from "@/hooks/useAlerts";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  requiresNetworkModule?: boolean;
  requiresRouterModule?: boolean;
  requiresLegacyHardening?: boolean;
  requiresDnsModule?: boolean;
  badge?: "alerts";
}

interface NavSection {
  label: string;
  icon: any;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Endpoints",
    icon: Monitor,
    items: [
      { name: "Endpoints", href: "/endpoints", icon: Monitor },
      { name: "Groups", href: "/groups", icon: FolderOpen },
    ],
  },
  {
    label: "Sites",
    icon: Globe,
    items: [
      { name: "WordPress sites", href: "/sites", icon: Globe },
    ],
  },
  {
    label: "Security",
    icon: ShieldCheck,
    items: [
      { name: "SOC Console", href: "/soc", icon: Activity },
      { name: "AI Agents", href: "/agents", icon: Sparkles },
      { name: "Cross-tenant Hunt", href: "/hunt", icon: Crosshair },
      { name: "AI Activity", href: "/ai-activity", icon: Sparkles },
      { name: "Incidents", href: "/incidents", icon: ShieldAlert },
      { name: "Alerts", href: "/alerts", icon: Bell, badge: "alerts" as const },
      { name: "Threats", href: "/threats", icon: AlertTriangle },
      { name: "Event Logs", href: "/logs", icon: ScrollText },
      { name: "Threat Hunting", href: "/threat-hunting", icon: Crosshair },
      { name: "Microsegmentation", href: "/microsegmentation", icon: Shield, requiresNetworkModule: true },
      { name: "App Whitelisting", href: "/app-whitelisting", icon: ShieldCheck },
      { name: "Process Telemetry", href: "/telemetry", icon: Activity },
      { name: "Vulnerabilities", href: "/vulnerabilities", icon: Bug },
      { name: "Identity (M365)", href: "/m365", icon: Cloud },
      { name: "M365 posture",    href: "/m365/posture", icon: ShieldCheck },
    ],
  },
  {
    label: "Configuration",
    icon: Cog,
    items: [
      { name: "Policies", href: "/policies", icon: FileText },
      { name: "Group Policy", href: "/group-policy", icon: SlidersHorizontal },
      { name: "Network", href: "/network", icon: Network, requiresNetworkModule: true },
      { name: "DNS Filtering", href: "/dns-filtering", icon: Globe, requiresDnsModule: true },
    ],
  },
  {
    label: "Infrastructure",
    icon: Router,
    items: [
      { name: "Routers", href: "/routers", icon: Router, requiresRouterModule: true },
    ],
  },
  {
    label: "Compliance",
    icon: Eye,
    items: [
      { name: "Legacy Hardening", href: "/legacy-hardening", icon: ShieldAlert, requiresLegacyHardening: true },
      { name: "Reports", href: "/reports", icon: ClipboardList },
      { name: "Customer Reports", href: "/customer-reports", icon: FileText },
      { name: "AI Advisor", href: "/recommendations", icon: Sparkles },
    ],
  },
  {
    label: "Management",
    icon: Wrench,
    items: [
      { name: "Deploy Agent", href: "/deploy", icon: Download },
      { name: "Activity", href: "/activity", icon: Activity },
      { name: "Users", href: "/users", icon: Users },
      { name: "Settings", href: "/settings", icon: Settings },
      { name: "Help", href: "/help", icon: BookOpen },
      { name: "SOPs", href: "/help/sops", icon: BookOpen },
      { name: "Glossary", href: "/glossary", icon: BookOpen },
    ],
  },
];

const adminNavigation = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Channel partners", href: "/admin/channel", icon: Building2 },
  { name: "All resellers", href: "/admin/resellers", icon: Briefcase },
  { name: "Deal pipeline", href: "/admin/deals", icon: Target },
  { name: "Credits", href: "/admin/credits", icon: Coins },
  { name: "Home users", href: "/admin/home-users", icon: Home },
  { name: "Pricing", href: "/admin/pricing", icon: Receipt },
  { name: "Invoices", href: "/admin/invoices", icon: FileText },
  { name: "AI costs", href: "/admin/ai-costs", icon: Sparkles },
  { name: "Distributor portal", href: "/distributor", icon: Warehouse },
  { name: "System Health", href: "/admin/health", icon: Activity },
  { name: "Audit logs", href: "/admin/audit-logs", icon: FileText },
  { name: "API keys", href: "/settings/api-keys", icon: KeyRound },
  { name: "API docs", href: "/api-docs", icon: BookOpen },
];

const socNavigation = [
  // External — handled with onClick (calls soc-bridge then window.open).
  { name: "SOC Dashboard", href: "#soc-bridge", icon: BarChart3 },
];

const partnerNavigation = [
  { name: "Partner dashboard", href: "/partner", icon: LayoutDashboard },
  { name: "My customers", href: "/my-customers", icon: Building2 },
  { name: "Deal pipeline", href: "/partner/deals", icon: Target },
  { name: "Credits", href: "/partner/credits", icon: Coins },
  { name: "Billing", href: "/partner/billing", icon: Receipt },
  { name: "Invoices", href: "/partner/invoices", icon: FileText },
  { name: "Sales kit", href: "/partner/resources", icon: BookOpen },
];

const distributorNavigation = [
  { name: "Distributor dashboard", href: "/distributor", icon: LayoutDashboard },
  { name: "My resellers", href: "/distributor/resellers", icon: Briefcase },
  { name: "Channel pipeline", href: "/distributor/deals", icon: Target },
  { name: "Credits", href: "/distributor/credits", icon: Coins },
  { name: "Billing", href: "/distributor/billing", icon: Receipt },
  { name: "Invoices", href: "/distributor/invoices", icon: FileText },
  { name: "Playbook & sales kit", href: "/distributor/resources", icon: BookOpen },
];

const customerNavigation = [
  { name: "My security", href: "/customer", icon: LayoutDashboard },
  { name: "My endpoints", href: "/customer/endpoints", icon: Monitor },
  { name: "My threats", href: "/customer/threats", icon: AlertTriangle },
  { name: "Install protection", href: "/deploy", icon: Download },
  { name: "Monthly reports", href: "/customer/reports", icon: FileText },
  { name: "Need help?", href: "/customer/contact", icon: BookOpen },
];

function isItemVisible(item: NavItem, org: any) {
  if (item.requiresNetworkModule && !org?.network_module_enabled) return false;
  if (item.requiresRouterModule && !org?.router_module_enabled) return false;
  if (item.requiresDnsModule && !org?.dns_module_enabled) return false;
  if (item.requiresLegacyHardening && !org?.legacy_hardening_enabled) return false;
  return true;
}

interface RoleSectionItem {
  name: string;
  href: string;
  icon: any;
  onClick?: () => void;
  externalIndicator?: string;
  title?: string;
}

interface RoleSectionProps {
  show: boolean;
  label: string;
  items: RoleSectionItem[];
  extraItems?: RoleSectionItem[];
  location: ReturnType<typeof useLocation>;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

function renderRoleSection(props: RoleSectionProps) {
  if (!props.show) return null;
  const { label, items, extraItems = [], location, collapsed, isOpen, onToggle } = props;
  const allItems = [...items, ...extraItems];
  const hasActive = allItems.some((i) => i.href && location.pathname === i.href);

  return (
    <nav key={label} className="border-b border-sidebar-border p-3 space-y-1">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          {allItems.map((item) => {
            const isActive = location.pathname === item.href;
            const inner = (
              <>
                <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
              </>
            );
            return item.onClick ? (
              <button key={item.name} type="button" onClick={item.onClick} title={item.title ?? item.name}
                className="flex items-center justify-center rounded-lg p-2 hover:bg-sidebar-accent">
                {inner}
              </button>
            ) : (
              <Link key={item.name} to={item.href} title={item.name}
                className={cn("flex items-center justify-center rounded-lg p-2", isActive ? "bg-primary/10" : "hover:bg-sidebar-accent")}>
                {inner}
              </Link>
            );
          })}
        </div>
      ) : (
        <>
          <button onClick={onToggle}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
              hasActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}>
            <span className="flex-1 text-left">{label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen && "rotate-180")} />
          </button>
          {isOpen && (
            <div className="mt-1 space-y-0.5">
              {items.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <Link key={item.name} to={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                      isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                    )}>
                    <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                    <span>{item.name}</span>
                    {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                  </Link>
                );
              })}
              {extraItems.map((item) => (
                <button key={item.name} type="button" onClick={item.onClick} title={item.title ?? item.name}
                  className="group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground">
                  <item.icon className="h-5 w-5 flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="flex-1 text-left">{item.name}</span>
                  {item.externalIndicator && <span className="text-[10px] text-muted-foreground">{item.externalIndicator}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </nav>
  );
}

interface SidebarProps {
  // Called whenever a nav item is clicked. Used by the mobile Sheet drawer
  // to auto-close after navigation. Desktop ignores this.
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps = {}) {
  const location = useLocation();
  const { currentOrganization, isSuperAdmin, isPartnerAdmin, isImpersonating, isLoading } = useTenant();
  const { data: alertCount } = useUnacknowledgedAlertCount();
  const [collapsed, setCollapsed] = useState(false);

  // When opened inside the mobile Sheet, auto-close the drawer the moment
  // the user navigates so they don't have to dismiss it manually.
  useEffect(() => {
    if (onNavigate) onNavigate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Auto-open sections that contain the active route. Covers the main
  // navSections list AND the four role-context nav lists (Admin, Partner,
  // Distributor, "My account") which used to render flat and pushed
  // the rest of the menu off-screen.
  const getInitialOpen = () => {
    const open: Record<string, boolean> = {};
    const path = location.pathname;
    navSections.forEach((section) => {
      const hasActive = section.items.some(
        (item) => isItemVisible(item, currentOrganization) && path === item.href
      );
      if (hasActive) open[section.label] = true;
    });
    if (adminNavigation.some((i) => path === i.href)) open["Admin"] = true;
    if (partnerNavigation.some((i) => path === i.href)) open["Partner"] = true;
    if (distributorNavigation.some((i) => path === i.href)) open["Distributor"] = true;
    if (customerNavigation.some((i) => path === i.href)) open["My account"] = true;
    return open;
  };

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(getInitialOpen);

  const toggleSection = (label: string) => {
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // SOC SSO bridge: mint a short-lived Grafana JWT cookie, then open Grafana.
  const openSocDashboard = async () => {
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.alert("You need to sign in again before opening the SOC dashboard.");
        return;
      }
      const resp = await fetch(`${supabaseUrl}/functions/v1/soc-bridge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = body?.error === "super_admin_required" ? "SOC dashboard access is super-admin only." : (body?.error ?? `HTTP ${resp.status}`);
        window.alert(`Could not open SOC dashboard: ${msg}`);
        return;
      }
      const url = body.soc_url ?? "https://soc.mithras.com.au";
      window.open(url, "_blank", "noopener");
    } catch (e) {
      window.alert("Could not open SOC dashboard: " + (e instanceof Error ? e.message : "Unknown"));
    }
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        <Link to="/dashboard" className="flex items-center gap-3">
          <img
            src="/mithras-shield.svg"
            alt="Mithras"
            className="h-9 w-9"
            width={36}
            height={36}
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-wider text-foreground">MITHRAS</span>
              <span className="text-[10px] tracking-[0.18em] uppercase text-primary">Threat Defence</span>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform",
              collapsed && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* Role-context nav (My account / Distributor / Partner / Admin).
          Each is a collapsible group with the same chevron pattern as the
          main Tenant sections so the menu stays scannable. Auto-opens on
          first mount when the active route is inside; user can toggle.
          When the sidebar itself is collapsed (narrow), the contents
          render unconditionally as icon-only nav. */}
      {renderRoleSection({
        show: currentOrganization?.organization_type === "customer",
        label: "My account",
        items: customerNavigation,
        location,
        collapsed,
        isOpen: openSections["My account"] ?? false,
        onToggle: () => toggleSection("My account"),
      })}

      {renderRoleSection({
        show: currentOrganization?.organization_type === "distributor",
        label: "Distributor",
        items: distributorNavigation,
        location,
        collapsed,
        isOpen: openSections["Distributor"] ?? false,
        onToggle: () => toggleSection("Distributor"),
      })}

      {renderRoleSection({
        show: !isSuperAdmin && isPartnerAdmin,
        label: "Partner",
        items: partnerNavigation,
        location,
        collapsed,
        isOpen: openSections["Partner"] ?? false,
        onToggle: () => toggleSection("Partner"),
      })}

      {renderRoleSection({
        show: !!isSuperAdmin,
        label: "Admin",
        items: adminNavigation,
        extraItems: socNavigation.map((item) => ({
          ...item,
          onClick: openSocDashboard,
          externalIndicator: "↗",
          title: "Single sign-on into the Grafana SOC dashboard",
        })),
        location,
        collapsed,
        isOpen: openSections["Admin"] ?? false,
        onToggle: () => toggleSection("Admin"),
      })}

      {/* Main Navigation - Collapsible Sections.
          Shown to every user — the new disty/customer portals are additive
          add-ons reachable by URL or via the channel-partner section above;
          they don't replace the existing operational sidebar for any
          current user. */}
      <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
        {!collapsed && isSuperAdmin && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
            Tenant
          </p>
        )}
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) =>
            isItemVisible(item, currentOrganization)
          );
          if (visibleItems.length === 0) return null;

          const isSectionOpen = openSections[section.label] ?? false;
          const hasActiveItem = visibleItems.some(
            (item) => location.pathname === item.href
          );

          return (
            <div key={section.label}>
              {/* Section header / toggle */}
              {collapsed ? (
                // In collapsed mode, just show section icon as a divider
                <div className="flex items-center justify-center py-2">
                  <section.icon className="h-4 w-4 text-muted-foreground/50" />
                </div>
              ) : (
                <button
                  onClick={() => toggleSection(section.label)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
                    hasActiveItem
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <section.icon className="h-3.5 w-3.5" />
                  <span className="flex-1 text-left">{section.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      isSectionOpen && "rotate-180"
                    )}
                  />
                </button>
              )}

              {/* Section items */}
              {(isSectionOpen || collapsed) && (
                <div className={cn("space-y-0.5", !collapsed && "ml-2 border-l border-sidebar-border pl-2 mb-2")}>
                  {visibleItems.map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                      <Link
                        key={item.name}
                        to={item.href}
                        className={cn(
                          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                          isActive
                            ? "bg-sidebar-accent text-primary"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-4 w-4 flex-shrink-0",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                          )}
                        />
                        {!collapsed && <span>{item.name}</span>}
                        {item.badge === "alerts" && !collapsed && alertCount && alertCount > 0 ? (
                          <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                            {alertCount > 99 ? "99+" : alertCount}
                          </span>
                        ) : isActive ? (
                          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Tenant selector */}
      {!collapsed && (
        <div className="border-t border-sidebar-border p-3">
          <div className={cn(
            "rounded-lg p-3",
            isImpersonating ? "bg-amber-500/10 border border-amber-500/30" : "bg-sidebar-accent"
          )}>
            <p className="text-xs text-muted-foreground">
              {isImpersonating ? "Viewing Tenant" : "Current Tenant"}
            </p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <>
                <p className={cn(
                  "text-sm font-medium",
                  isImpersonating ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                )}>
                  {currentOrganization?.name || "No Organization"}
                </p>
                {isImpersonating && (
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                    Super Admin Mode
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
