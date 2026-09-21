'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, clearAuth, type AuthUser } from '@/lib/api';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  isGuest: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (partial: Partial<AuthUser>) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem('cs_user');
    const token  = localStorage.getItem('cs_token');
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        // Background sync latest user data (including avatar_url) from backend
        authApi.me().then(res => {
          if (res?.user) {
            setUser(res.user);
            localStorage.setItem('cs_user', JSON.stringify(res.user));
          }
        }).catch(() => {
          if (!localStorage.getItem('cs_token')) setUser(null);
        });
      } catch {
        clearAuth();
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    localStorage.setItem('cs_token', data.access_token);
    localStorage.setItem('cs_refresh_token', data.refresh_token);
    localStorage.setItem('cs_user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      const rt = localStorage.getItem('cs_refresh_token');
      if (rt) await authApi.logout(rt);
    } catch { /* ignore */ }
    clearAuth();
    setUser(null);
    router.push('/login');
  }, [router]);

  /** Merge partial updates into the current user and persist to localStorage. */
  const updateUser = useCallback((partial: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...partial };
      localStorage.setItem('cs_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

    const isGuest = user?.role === 'guest';

    return (
      <AuthContext.Provider value={{ user, loading, isGuest, login, logout, updateUser }}>
        {children}
      </AuthContext.Provider>
    );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
