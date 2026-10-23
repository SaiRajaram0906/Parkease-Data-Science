import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Car, User, Menu, X, LogIn, LogOut, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-600",
  owner: "bg-blue-500/15 text-blue-600",
  driver: "bg-green-500/15 text-green-600",
};

export function Navbar() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const { toast } = useToast();

  // Each kind of account gets its own menu:
  //   driver  finds and books parking
  //   owner   lists parking, sees its analytics and checks entry passes
  //   admin   everything
  const role = user?.role;
  const parks = role === "driver" || role === "admin";
  const lists = role === "owner" || role === "admin";
  const navItems = isAuthenticated ? [
    ...(parks ? [{ label: "Find Parking", path: "/spots" }, { label: "My Bookings", path: "/bookings" }] : []),
    { label: "Dashboard", path: "/dashboard" },
    ...(lists ? [{ label: "Analytics", path: "/analytics" }, { label: "Verify Entry", path: "/verify" }] : []),
    ...(role === "admin" ? [{ label: "Admin", path: "/admin" }] : []),
  ] : [];
  // Shown to owners, and to visitors (who are asked to sign in first).
  const showListSpot = !isAuthenticated || lists;

  const handleLogout = () => {
    logout();
    toast({ title: "Logged out", description: "See you next time!" });
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 transition-transform hover:scale-105 active:scale-95">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
                <Car className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold tracking-tight">
                ParkEase
              </span>
            </Link>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  href={item.path}
                  className={cn(
                    "px-4 py-2 rounded-md text-sm font-medium transition-colors hover:bg-muted",
                    location === item.path ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            
            <div className="h-6 w-px bg-border mx-2" />
            
            <div className="flex items-center gap-3">
              {showListSpot && (
                <Link href="/list-spot">
                  <Button variant="outline" className="font-semibold border-primary/20 hover:border-primary/50 hover:bg-primary/5">
                    List Your Spot
                  </Button>
                </Link>
              )}

              {isAuthenticated && parks && <NotificationBell />}

              {isAuthenticated && user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 h-9 px-3 rounded-full">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm max-w-24 truncate">{user.name.split(" ")[0]}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <p className="font-semibold">{user.name}</p>
                      <p className="text-xs text-muted-foreground font-normal truncate">{user.email}</p>
                      <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full mt-1.5 inline-block capitalize", ROLE_COLORS[user.role] || ROLE_COLORS.driver)}>
                        {user.role}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="cursor-pointer">
                        <User className="mr-2 h-4 w-4" />
                        My Profile
                      </Link>
                    </DropdownMenuItem>
                    {parks && (
                      <DropdownMenuItem asChild>
                        <Link href="/bookings" className="cursor-pointer">
                          My Bookings
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600 cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link href="/login">
                  <Button className="font-semibold" size="sm">
                    <LogIn className="h-4 w-4 mr-1.5" />
                    Sign in
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="md:hidden flex items-center gap-1">
            {isAuthenticated && parks && <NotificationBell />}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-background animate-in slide-in-from-top-2">
          <div className="px-4 pt-2 pb-4 space-y-1">
            {isAuthenticated && user && (
              <div className="flex items-center gap-3 p-3 mb-2 bg-muted/40 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm">{user.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
              </div>
            )}
            {navItems.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-3 py-2 rounded-md text-base font-medium",
                  location === item.path ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-4 pt-4 border-t flex flex-col gap-2">
              {showListSpot && (
                <Link href="/list-spot" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full justify-center">
                    List Your Spot
                  </Button>
                </Link>
              )}
              {isAuthenticated ? (
                <>
                  <Link href="/profile" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" className="w-full justify-start">
                      <User className="mr-2 h-4 w-4" />
                      My Profile
                    </Button>
                  </Link>
                  <Button variant="ghost" className="w-full justify-start text-red-600 hover:text-red-600" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </Button>
                </>
              ) : (
                <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full justify-center">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign in
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
