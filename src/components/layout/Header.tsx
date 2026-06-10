import { Bell, User, LogOut, Eye, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, Link } from "react-router-dom";
import { TenantSwitcher } from "./TenantSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { useUnacknowledgedAlertCount } from "@/hooks/useAlerts";
import { useTenant } from "@/contexts/TenantContext";

interface HeaderProps {
  // Provided by MainLayout when the viewport is below the md breakpoint —
  // clicking opens the mobile sidebar Sheet. Undefined on desktop where
  // the hamburger isn't needed.
  onOpenMobileNav?: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps = {}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: alertCount } = useUnacknowledgedAlertCount();
  const { isImpersonating, currentOrganization } = useTenant();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 sm:px-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 sm:gap-4">
        {onOpenMobileNav && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onOpenMobileNav}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <GlobalSearch />
        {isImpersonating && currentOrganization && (
          <Badge variant="outline" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1.5">
            <Eye className="h-3 w-3" />
            Viewing as <span className="font-semibold">{currentOrganization.name}</span>
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4">
        <TenantSwitcher />

        <StatusBadge status="healthy" label="All Systems Operational" pulse />

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          asChild
          title={(alertCount ?? 0) > 0 ? `${alertCount} unacknowledged alerts` : "Alerts"}
          aria-label={(alertCount ?? 0) > 0 ? `${alertCount} unacknowledged alerts` : "Alerts"}
        >
          <Link to="/alerts">
            <Bell className="h-5 w-5" />
            {(alertCount ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {alertCount! > 99 ? "99+" : alertCount}
              </span>
            )}
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 border-l border-border pl-4 hover:opacity-80 transition-opacity">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                {initials}
              </div>
              <div className="hidden lg:block text-left">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="flex items-center gap-2 text-destructive focus:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
