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
import { ChatBot } from "@/components/chat/ChatBot";
import { GoogleMapsProvider } from "@/context/GoogleMapsContext";

const queryClient = new QueryClient();

import { useAuth } from "@/context/AuthContext";
import { Redirect } from "wouter";

function ProtectedRoute({ path, component: Component }: { path: string, component: any }) {
  const { isAuthenticated } = useAuth();
  return (
    <Route path={path}>
      {isAuthenticated ? <Component /> : <Redirect to="/login" />}
    </Route>
  );
}

/** A page only some roles may open. Others are sent to their dashboard. */
function RoleRoute({ path, component: Component, roles }: { path: string, component: any, roles: string[] }) {
  const { isAuthenticated, user } = useAuth();
  return (
    <Route path={path}>
      {!isAuthenticated ? <Redirect to="/login" /> : roles.includes(user?.role ?? "") ? <Component /> : <Redirect to="/dashboard" />}
    </Route>
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
            <main className="flex-1 flex flex-col relative">
              <Switch>
                <Route path="/" component={Home} />
                <ProtectedRoute path="/spots" component={Spots} />
                <ProtectedRoute path="/spots/:id" component={SpotDetail} />
                <ProtectedRoute path="/bookings" component={Bookings} />
                <ProtectedRoute path="/bookings/:id" component={BookingDetail} />
                <ProtectedRoute path="/dashboard" component={Dashboard} />
                <RoleRoute path="/analytics" component={Analytics} roles={["owner", "admin"]} />
                <RoleRoute path="/admin" component={Admin} roles={["admin"]} />
                <ProtectedRoute path="/profile" component={Profile} />
                <ProtectedRoute path="/list-spot" component={ListSpot} />
                <Route component={NotFound} />
              </Switch>
              <ChatBot />
            </main>
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
