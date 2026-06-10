import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Monitor,
  AlertTriangle,
  ScrollText,
  Crosshair,
  LayoutDashboard,
  FileText,
  Settings,
  Users,
  Activity,
  Download,
  FolderOpen,
  Sparkles,
  Network,
  Router,
  ClipboardList,
  Building2,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  href: string;
  category: string;
  badge?: string;
  badgeVariant?: "default" | "destructive" | "secondary" | "outline";
}

const navPages: SearchResult[] = [
  { id: "nav-dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, href: "/dashboard", category: "Pages" },
  { id: "nav-endpoints", label: "Endpoints", icon: <Monitor className="h-4 w-4" />, href: "/endpoints", category: "Pages" },
  { id: "nav-groups", label: "Groups", icon: <FolderOpen className="h-4 w-4" />, href: "/groups", category: "Pages" },
  { id: "nav-threats", label: "Threats", icon: <AlertTriangle className="h-4 w-4" />, href: "/threats", category: "Pages" },
  { id: "nav-logs", label: "Event Logs", icon: <ScrollText className="h-4 w-4" />, href: "/logs", category: "Pages" },
  { id: "nav-hunting", label: "Threat Hunting", icon: <Crosshair className="h-4 w-4" />, href: "/threat-hunting", category: "Pages" },
  { id: "nav-policies", label: "Policies", icon: <FileText className="h-4 w-4" />, href: "/policies", category: "Pages" },
  { id: "nav-network", label: "Network Security", icon: <Network className="h-4 w-4" />, href: "/network", category: "Pages" },
  { id: "nav-routers", label: "Routers", icon: <Router className="h-4 w-4" />, href: "/routers", category: "Pages" },
  { id: "nav-reports", label: "Reports", icon: <ClipboardList className="h-4 w-4" />, href: "/reports", category: "Pages" },
  { id: "nav-advisor", label: "AI Advisor", icon: <Sparkles className="h-4 w-4" />, href: "/recommendations", category: "Pages" },
  { id: "nav-deploy", label: "Deploy Agent", icon: <Download className="h-4 w-4" />, href: "/deploy", category: "Pages" },
  { id: "nav-activity", label: "Activity", icon: <Activity className="h-4 w-4" />, href: "/activity", category: "Pages" },
  { id: "nav-users", label: "Users", icon: <Users className="h-4 w-4" />, href: "/users", category: "Pages" },
  { id: "nav-settings", label: "Settings", icon: <Settings className="h-4 w-4" />, href: "/settings", category: "Pages" },
  { id: "nav-admin", label: "Customers (Admin)", icon: <Building2 className="h-4 w-4" />, href: "/admin", category: "Pages" },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { currentOrganization } = useTenant();

  // Keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Search database when query changes
  const search = useCallback(
    async (q: string) => {
      if (!q || q.length < 2 || !currentOrganization?.id) {
        setResults([]);
        return;
      }

      setLoading(true);
      const orgId = currentOrganization.id;
      const searchTerm = `%${q}%`;

      try {
        const [endpointsRes, threatsRes, iocsRes] = await Promise.all([
          supabase
            .from("endpoints")
            .select("id, hostname, is_online, os_version")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .ilike("hostname", searchTerm)
            .limit(5),
          supabase
            .from("endpoint_threats")
            .select("id, threat_name, severity, status, endpoints!inner(hostname, organization_id)")
            .eq("endpoints.organization_id", orgId)
            .ilike("threat_name", searchTerm)
            .limit(5),
          supabase
            .from("ioc_library")
            .select("id, value, ioc_type, severity, threat_name")
            .eq("organization_id", orgId)
            .or(`value.ilike.${searchTerm},threat_name.ilike.${searchTerm}`)
            .limit(5),
        ]);

        const mapped: SearchResult[] = [];

        if (endpointsRes.data) {
          for (const ep of endpointsRes.data) {
            mapped.push({
              id: `ep-${ep.id}`,
              label: ep.hostname,
              description: ep.os_version || undefined,
              icon: <Monitor className="h-4 w-4" />,
              href: "/endpoints",
              category: "Endpoints",
              badge: ep.is_online ? "Online" : "Offline",
              badgeVariant: ep.is_online ? "default" : "destructive",
            });
          }
        }

        if (threatsRes.data) {
          for (const t of threatsRes.data) {
            mapped.push({
              id: `threat-${t.id}`,
              label: t.threat_name,
              description: `Severity: ${t.severity}`,
              icon: <AlertTriangle className="h-4 w-4" />,
              href: "/threats",
              category: "Threats",
              badge: t.status,
              badgeVariant: t.severity === "Severe" || t.severity === "High" ? "destructive" : "secondary",
            });
          }
        }

        if (iocsRes.data) {
          for (const ioc of iocsRes.data) {
            mapped.push({
              id: `ioc-${ioc.id}`,
              label: ioc.value,
              description: ioc.threat_name || ioc.ioc_type,
              icon: <Crosshair className="h-4 w-4" />,
              href: "/threat-hunting",
              category: "IOC Library",
              badge: ioc.severity,
              badgeVariant: ioc.severity === "critical" || ioc.severity === "high" ? "destructive" : "secondary",
            });
          }
        }

        setResults(mapped);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    },
    [currentOrganization?.id]
  );

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery("");
    navigate(href);
  };

  // Filter nav pages by query
  const filteredPages = query.length > 0
    ? navPages.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))
    : navPages.slice(0, 6);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground w-80"
      >
        <Search className="h-4 w-4" />
        <span>Search endpoints, threats…</span>
        <kbd className="ml-auto pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search endpoints, threats, IOCs, pages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {loading ? "Searching…" : "No results found."}
          </CommandEmpty>

          {results.length > 0 && (
            <>
              {["Endpoints", "Threats", "IOC Library"].map((cat) => {
                const items = results.filter((r) => r.category === cat);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={cat} heading={cat}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        onSelect={() => handleSelect(item.href)}
                        className="flex items-center gap-3"
                      >
                        {item.icon}
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">{item.label}</span>
                          {item.description && (
                            <span className="text-xs text-muted-foreground truncate">
                              {item.description}
                            </span>
                          )}
                        </div>
                        {item.badge && (
                          <Badge variant={item.badgeVariant} className="ml-auto text-[10px] shrink-0">
                            {item.badge}
                          </Badge>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
              <CommandSeparator />
            </>
          )}

          {filteredPages.length > 0 && (
            <CommandGroup heading="Pages">
              {filteredPages.map((page) => (
                <CommandItem
                  key={page.id}
                  onSelect={() => handleSelect(page.href)}
                  className="flex items-center gap-3"
                >
                  {page.icon}
                  <span>{page.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
