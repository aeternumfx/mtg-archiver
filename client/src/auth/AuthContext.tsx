import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setOnUnauthorized, type AuthUser } from '../api/client';
import { resetTradeBuilder } from '../stores/tradeBuilder';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  demoLogin: () => Promise<AuthUser>;
  setupLogin: (token: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  refresh: () => Promise<void>;
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    navigate('/login');
  }, [navigate]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
    return () => setOnUnauthorized(null);
  }, [handleUnauthorized]);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.auth.me();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clear the persistent trade builder when the signed-in user changes (incl. logout).
  useEffect(() => {
    resetTradeBuilder();
  }, [user?.id]);

  const login = useCallback(async (username: string, password: string) => {
    const { user: u } = await api.auth.login(username, password);
    setUser(u);
    return u;
  }, []);

  const demoLogin = useCallback(async () => {
    const { user: u } = await api.auth.demoLogin();
    setUser(u);
    return u;
  }, []);

  const setupLogin = useCallback(async (token: string) => {
    const { user: u } = await api.auth.setupLogin(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
    navigate('/');
  }, [navigate]);

  const exitImpersonation = useCallback(async () => {
    try {
      await api.auth.exitImpersonation();
    } catch {
      /* ignore */
    }
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, login, demoLogin, setupLogin, logout, setUser, refresh, exitImpersonation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
