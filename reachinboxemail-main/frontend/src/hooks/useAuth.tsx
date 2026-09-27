import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, oauthUrl } from "../services/api";
import type { Sender, User } from "../types";

interface AuthContextValue {
  user: User | null;
  senders: Sender[];
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  startGoogleLogin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      setSenders(data.senders);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setSenders([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    window.location.href = "/";
  }, []);

  const startGoogleLogin = useCallback(() => {
    // Real Google OAuth: full-page navigation to the backend flow.
    window.location.href = oauthUrl("/api/auth/google/login");
  }, []);

  return (
    <AuthContext.Provider value={{ user, senders, loading, refresh, logout, startGoogleLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
