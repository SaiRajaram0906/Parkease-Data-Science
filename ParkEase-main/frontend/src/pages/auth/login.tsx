import { useState } from "react";
import { useLocation, Link } from "wouter";
import { demoSignIn, registerAccount, signIn, type AuthResult } from "@/lib/auth-api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Car, MapPin } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<"driver" | "owner">("driver");

  const handleToggleMode = () => {
    setAuthMode(authMode === "login" ? "register" : "login");
    setPasswordError("");
    setPassword("");
  };

  const finish = (result: AuthResult, title: string) => {
    login(result.user, result.token);
    toast({
      title,
      description: result.passwordSet
        ? "Your password has been saved for this account."
        : `Signed in as ${result.user.name} (${result.user.role})`,
    });
    setLocation("/");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setIsLoading(true);
    setPasswordError("");

    try {
      if (authMode === "register") {
        if (!name.trim()) {
          toast({ title: "Name required", description: "Enter your name to create an account.", variant: "destructive" });
          return;
        }
        // Same rule the server enforces.
        const strongPasswordRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;
        if (!strongPasswordRegex.test(password)) {
          setPasswordError("Password must be at least 8 characters, include 1 number and 1 special symbol.");
          return;
        }
        const result = await registerAccount({ name: name.trim(), email: email.trim(), password, role });
        finish(result, "Account created!");
      } else {
        const result = await signIn({ email: email.trim(), password });
        finish(result, "Welcome back!");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      if (/password/i.test(message)) setPasswordError(message);
      toast({ title: authMode === "login" ? "Sign in failed" : "Could not create the account", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async (demoRole: "driver" | "owner" | "admin") => {
    try {
      finish(await demoSignIn(demoRole), "Demo account");
    } catch {
      toast({ title: "Demo login failed", description: "Is the ParkEase server running?", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#1a1a2e] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-10 w-72 h-72 bg-[#4ade80] rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#22d3ee] rounded-full blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 bg-[#4ade80] rounded-xl flex items-center justify-center">
              <Car className="w-6 h-6 text-[#1a1a2e]" />
            </div>
            <span className="text-2xl font-bold text-white">ParkEase</span>
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-6">
            Smart parking for<br />
            <span className="text-[#4ade80]">India's restless streets.</span>
          </h1>
          <p className="text-white/60 text-lg leading-relaxed">
            Find, book, and secure parking across Mumbai, Delhi, Bengaluru, Hyderabad, and more — by the hour or day.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-4">
          {[
            { city: "Mumbai", spots: "2,400+" },
            { city: "Delhi", spots: "1,800+" },
            { city: "Bengaluru", spots: "1,500+" },
          ].map((item) => (
            <div key={item.city} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <MapPin className="w-4 h-4 text-[#4ade80] mb-2" />
              <p className="text-white font-bold text-lg">{item.spots}</p>
              <p className="text-white/50 text-sm">{item.city}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 bg-[#4ade80] rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-[#1a1a2e]" />
            </div>
            <span className="text-xl font-bold">ParkEase</span>
          </div>

          <h2 className="text-3xl font-bold mb-2">{authMode === "login" ? "Welcome back" : "Create an account"}</h2>
          <p className="text-muted-foreground mb-8">
            {authMode === "login" ? "Sign in to your account to continue" : "Enter your details to get started"}
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            
            {authMode === "register" && (
              <div>
                <Label htmlFor="name" className="text-sm font-medium">
                  Full name
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Priya Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 h-11"
                  required={authMode === "register"}
                />
              </div>
            )}

            {authMode === "register" && (
              <div>
                <Label className="text-sm font-medium">I want to</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                  {([["driver", "Find parking", "Driver"], ["owner", "List my parking space", "Owner"]] as const).map(([value, text, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRole(value)}
                      aria-pressed={role === value}
                      className={`rounded-xl border-2 p-3 text-left transition-colors ${
                        role === value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="block text-xs text-muted-foreground">{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 h-11"
                required
              />
            </div>

            <div>
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`mt-1.5 h-11 ${passwordError ? 'border-destructive' : ''}`}
                required
              />
              {passwordError && (
                <p className="text-xs text-destructive mt-1.5">{passwordError}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11 font-semibold bg-[#4ade80] hover:bg-[#22c55e] text-white mt-2" disabled={isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {authMode === "login" ? "Continue" : "Register"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            {authMode === "login" ? (
              <p>Don't have an account? <span onClick={handleToggleMode} className="text-[#4ade80] hover:underline cursor-pointer font-medium">Register</span></p>
            ) : (
              <p>Already have an account? <span onClick={handleToggleMode} className="text-[#4ade80] hover:underline cursor-pointer font-medium">Sign in</span></p>
            )}
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-background px-3 text-muted-foreground">or try a demo account</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Button variant="outline" className="h-11 flex-col gap-0.5 text-xs" onClick={() => handleDemoLogin("driver")}>
              <span className="font-semibold">Driver</span>
              <span className="text-muted-foreground">Priya</span>
            </Button>
            <Button variant="outline" className="h-11 flex-col gap-0.5 text-xs" onClick={() => handleDemoLogin("owner")}>
              <span className="font-semibold">Owner</span>
              <span className="text-muted-foreground">Rajesh</span>
            </Button>
            <Button variant="outline" className="h-11 flex-col gap-0.5 text-xs" onClick={() => handleDemoLogin("admin")}>
              <span className="font-semibold">Admin</span>
              <span className="text-muted-foreground">Vikram</span>
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-8">
            By continuing, you agree to ParkEase's Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
