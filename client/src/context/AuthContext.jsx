import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,             setUser]             = useState(null);
  const [token,            setToken]            = useState(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // ── Clear all auth state ───────────────────────────────────────────────
  const clearAuth = useCallback(() => {
    localStorage.removeItem('church_token');
    localStorage.removeItem('church_user');
    setToken(null);
    setUser(null);
  }, []);

  // ── Login — called after successful POST /api/auth/google ─────────────
  const login = useCallback((newToken, newUser) => {
    localStorage.setItem('church_token', newToken);
    localStorage.setItem('church_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearAuth();
    window.location.href = '/login';
  }, [clearAuth]);

  // ── On mount: validate stored JWT via GET /api/auth/me ────────────────
  // Shows FullScreenSpinner until this resolves.
  // Prevents flash of unauthenticated content.
  useEffect(() => {
    const storedToken = localStorage.getItem('church_token');

    if (!storedToken) {
      setIsInitialLoading(false);
      return;
    }

    setToken(storedToken);

    client.get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        // Keep localStorage user in sync
        localStorage.setItem('church_user', JSON.stringify(data.user));
      })
      .catch(() => {
        // Token invalid or expired — clear everything
        clearAuth();
      })
      .finally(() => {
        setIsInitialLoading(false);
      });
  }, [clearAuth]);

  const value = {
    user,
    token,
    isInitialLoading,
    isAuthenticated: !!user,
    login,
    logout,
    clearAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
