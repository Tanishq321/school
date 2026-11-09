import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionChange, refreshSession, setSession } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authed | anon
  const [config, setConfig] = useState({ requireEmailVerification: true });

  useEffect(() => {
    api('/config').then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    const off = onSessionChange((u, token) => {
      if (u) setUser(u);
      if (!token) {
        setUser(null);
        setStatus('anon');
      }
    });
    // Restore the session from the httpOnly refresh cookie.
    refreshSession()
      .then(({ user: u }) => {
        setUser(u);
        setStatus('authed');
      })
      .catch(() => setStatus('anon'));
    return off;
  }, []);

  const start = useCallback(({ user: u, accessToken }) => {
    setSession(accessToken, u);
    setUser(u);
    setStatus('authed');
    return u;
  }, []);

  const login = useCallback(async (email, password) => start(await api('/auth/login', { method: 'POST', body: { email, password } })), [start]);
  const register = useCallback(async (data) => start(await api('/auth/register', { method: 'POST', body: data })), [start]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null, null);
  }, []);
  const reloadUser = useCallback(async () => {
    const { user: u } = await api('/auth/me');
    setUser(u);
    return u;
  }, []);

  // Mirrors the server policy; the server still enforces it.
  const needsVerification = Boolean(user && config.requireEmailVerification && !user.emailVerified);
  const value = useMemo(
    () => ({ user, status, config, needsVerification, login, register, logout, reloadUser, setUser }),
    [user, status, config, needsVerification, login, register, logout, reloadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
