import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, ChevronDown, LogOut, Eye, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

export function TenantSwitcher() {
  const {
    currentOrganization,
    userOrganization,
    isSuperAdmin,
    isPartnerAdmin,
    isImpersonating,
    allOrganizations,
    partnerCustomers,
    setImpersonatedOrg,
  } = useTenant();

  // Only show for super admins or partner admins with customers.
  //
  // Computed here, returned below the hooks. As an early return it put
  // useState/useMemo behind a condition, so the hook count changed the moment
  // a partner's customer list loaded (partnerCustomers.length 0 -> n) and
  // React threw "Rendered more hooks than during the previous render".
  const shouldHide = !isSuperAdmin && (!isPartnerAdmin || partnerCustomers.length === 0);

  const handleExitImpersonation = () => {
    setImpersonatedOrg(null);
  };

  // Determine which organizations to show
  const availableOrgs = isSuperAdmin ? allOrganizations : partnerCustomers;
  const switcherLabel = isSuperAdmin ? "View as Tenant" : "Switch Customer";

  // MAJOR fix: a dropdown of 200+ tenants without search forces operators to
  // scroll-mash every time they want a specific customer. Add a tiny in-list
  // filter.
  const [query, setQuery] = useState("");
  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableOrgs;
    return availableOrgs.filter(o => o.name?.toLowerCase().includes(q) || (o as any).slug?.toLowerCase().includes(q));
  }, [availableOrgs, query]);

  if (shouldHide) return null;

  return (
    <div className="flex items-center gap-2">
      {isImpersonating && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-1.5">
          <Eye className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Viewing: {currentOrganization?.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 ml-1 hover:bg-amber-500/20"
            onClick={handleExitImpersonation}
          >
            <LogOut className="h-3 w-3 mr-1" />
            Exit
          </Button>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {isSuperAdmin ? <Building2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {isImpersonating ? "Switch" : switcherLabel}
            </span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-hidden flex flex-col">
          <DropdownMenuLabel>
            {isSuperAdmin ? "Select Tenant" : "Select Customer"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <div className="px-2 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={availableOrgs.length > 8 ? `Search ${availableOrgs.length} tenants…` : "Search…"}
                className="h-8 pl-7 text-sm"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <DropdownMenuSeparator />

          <div className="flex-1 overflow-y-auto">
          {isImpersonating && (
            <>
              <DropdownMenuItem onClick={handleExitImpersonation}>
                <LogOut className="h-4 w-4 mr-2" />
                Exit to {userOrganization?.name}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {filteredOrgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => setImpersonatedOrg(org)}
              className={cn(
                "flex items-center gap-2",
                currentOrganization?.id === org.id && "bg-accent"
              )}
            >
              <Building2 className="h-4 w-4" />
              <div className="flex-1 truncate">
                <span>{org.name}</span>
                {org.organization_type === "partner" && (
                  <span className="ml-1 text-xs text-primary">(Partner)</span>
                )}
              </div>
              {org.id === userOrganization?.id && (
                <span className="text-xs text-muted-foreground">(yours)</span>
              )}
            </DropdownMenuItem>
          ))}

          {filteredOrgs.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {availableOrgs.length === 0 ? "No organizations found" : "No matches"}
            </div>
          )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
