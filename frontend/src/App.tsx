import type { ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";
import { Navbar } from "@/components/layout/Navbar";
import Home from "@/pages/home";
import Spots from "@/pages/spots";
import SpotDetail from "@/pages/spots/detail";
import Bookings from "@/pages/bookings";
import BookingDetail from "@/pages/bookings/detail";
import Dashboard from "@/pages/dashboard";
import Analytics from "@/pages/analytics";
import Admin from "@/pages/admin";
import Profile from "@/pages/profile";
import ListSpot from "@/pages/list-spot";
import Login from "@/pages/auth/login";
import VerifyEntry from "@/pages/verify";
import { ChatBot } from "@/components/chat/ChatBot";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { GoogleMapsProvider } from "@/context/GoogleMapsContext";

const queryClient = new QueryClient();

import { useAuth } from "@/context/AuthContext";
import { Redirect, useLocation } from "wouter";

function ProtectedRoute({ path, component: Component }: { path: string, component: any }) {
  const { isAuthenticated } = useAuth();
  return (
    <Route path={path}>
      {isAuthenticated ? <Component /> : <Redirect to="/login" />}
    </Route>
  );
}

/**
 * A page only some roles may open. Others are sent to their dashboard.
 * Someone who is not signed in is sent to the login page and brought back
 * afterwards (this is how a scanned QR entry pass reaches the verify page).
 */
function RoleRoute({ path, component: Component, roles }: { path: string, component: any, roles: string[] }) {
  const { isAuthenticated, user } = useAuth();
  return (
    <Route path={path}>
      {!isAuthenticated ? <RedirectToLogin /> : roles.includes(user?.role ?? "") ? <Component /> : <Redirect to="/dashboard" />}
    </Route>
  );
}

function RedirectToLogin() {
  const [location] = useLocation();
  return <Redirect to={location.startsWith("/verify/") ? `/login?next=${encodeURIComponent(location)}` : "/login"} />;
}

/** The parking assistant finds parking, so owner accounts do not get it. */
function AssistantForDrivers() {
  const { user, isAuthenticated } = useAuth();
  return user?.role === "owner" ? null : <ChatBot aboveTabBar={isAuthenticated} />;
}

/** Leaves room at the bottom of every page for the phone tab bar. */
function Main({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return (
    <main className={`flex-1 flex flex-col relative ${isAuthenticated ? "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}>
      {children}
    </main>
  );
}

function Router() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Switch>
        <Route path="/login">
          <Login />
        </Route>
        <Route>
          <>
            <Navbar />
            <Main>
              <Switch>
                <Route path="/" component={Home} />
                {/* Driver pages: finding and booking parking */}
                <RoleRoute path="/spots" component={Spots} roles={["driver", "admin"]} />
                <RoleRoute path="/bookings" component={Bookings} roles={["driver", "admin"]} />
                <RoleRoute path="/bookings/:id" component={BookingDetail} roles={["driver", "admin"]} />
                {/* Owner pages: listing parking, analytics, checking entry passes */}
                <RoleRoute path="/list-spot" component={ListSpot} roles={["owner", "admin"]} />
                <RoleRoute path="/analytics" component={Analytics} roles={["owner", "admin"]} />
                <RoleRoute path="/verify" component={VerifyEntry} roles={["owner", "admin"]} />
                <RoleRoute path="/verify/:code" component={VerifyEntry} roles={["owner", "admin"]} />
                <RoleRoute path="/admin" component={Admin} roles={["admin"]} />
                {/* Shared: a spot page (owners open their own listings), dashboard, profile */}
                <ProtectedRoute path="/spots/:id" component={SpotDetail} />
                <ProtectedRoute path="/dashboard" component={Dashboard} />
                <ProtectedRoute path="/profile" component={Profile} />
                <Route component={NotFound} />
              </Switch>
              <AssistantForDrivers />
            </Main>
            <MobileTabBar />
          </>
        </Route>
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GoogleMapsProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </GoogleMapsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
