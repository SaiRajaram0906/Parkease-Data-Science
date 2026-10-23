import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { ApiRequestError, TOKEN_KEY, fetchMe, storedToken } from "@/lib/auth-api";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  avatarUrl?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  /** Re-reads the signed-in user from the server (for example after a role change). */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const USER_KEY = "parkease_user";

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  refreshUser: async () => {},
  isAuthenticated: false,
});

// Every request made through the generated API client carries the token.
setAuthTokenGetter(() => storedToken());

function readStoredUser(): AuthUser | null {
  try {
    // A stored user without a token comes from before real sign-in existed.
    if (!storedToken()) return null;
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);

  const login = (userData: AuthUser, token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!storedToken()) return;
    try {
      const { user: fresh } = await fetchMe();
      localStorage.setItem(USER_KEY, JSON.stringify(fresh));
      setUser(fresh);
    } catch (error) {
      // The token expired or the account no longer exists: sign out.
      if (error instanceof ApiRequestError && error.status === 401) logout();
    }
  }, [logout]);

  // Confirm the stored session with the server when the app opens.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
