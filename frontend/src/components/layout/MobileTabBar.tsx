import { Link, useLocation } from "wouter";
import { BarChart3, CalendarCheck, Car, Home, LayoutDashboard, PlusCircle, ScanLine, Search, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

type Tab = { label: string; path: string; icon: typeof Home };

/** The tabs each kind of account gets on a phone (same split as the top menu). */
export function tabsFor(role: string | undefined): Tab[] {
  if (role === "owner") {
    return [
      { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
      { label: "Analytics", path: "/analytics", icon: BarChart3 },
      { label: "Verify", path: "/verify", icon: ScanLine },
      { label: "List spot", path: "/list-spot", icon: PlusCircle },
      { label: "Profile", path: "/profile", icon: User },
    ];
  }
  if (role === "admin") {
    return [
      { label: "Find", path: "/spots", icon: Search },
      { label: "Bookings", path: "/bookings", icon: CalendarCheck },
      { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
      { label: "Admin", path: "/admin", icon: Shield },
      { label: "Profile", path: "/profile", icon: User },
    ];
  }
  return [
    { label: "Home", path: "/", icon: Home },
    { label: "Find", path: "/spots", icon: Car },
    { label: "Bookings", path: "/bookings", icon: CalendarCheck },
    { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { label: "Profile", path: "/profile", icon: User },
  ];
}

/**
 * App-style bottom navigation on phones (hidden from tablet width up). It
 * sits above the iPhone home indicator thanks to the safe-area padding.
 */
export function MobileTabBar() {
  const { user, isAuthenticated } = useAuth();
  const [location] = useLocation();
  if (!isAuthenticated) return null;
  const tabs = tabsFor(user?.role);
  const active = (path: string) => (path === "/" ? location === "/" : location === path || location.startsWith(`${path}/`));

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
    >
      <ul className="grid grid-cols-5">
        {tabs.map(({ label, path, icon: Icon }) => (
          <li key={path}>
            <Link
              href={path}
              aria-current={active(path) ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                active(path) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("h-5 w-5", active(path) && "stroke-[2.5]")} aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
