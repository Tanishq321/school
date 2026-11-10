import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionChange, refreshSession, sessionBody, setSession } from '../services/api.js';
import { sessionStore } from '../services/platform.js';

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

  /** Returns the user, or { twoFactorRequired, challenge } when a second step is needed. */
  const login = useCallback(
    async (email, password) => {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      return res.twoFactorRequired ? res : start(res);
    },
    [start],
  );
  const loginSecondStep = useCallback(
    async (challenge, code) => {
      const res = await api('/auth/login/2fa', { method: 'POST', body: { challenge, code } });
      start(res);
      return res;
    },
    [start],
  );
  const register = useCallback(async (data) => start(await api('/auth/register', { method: 'POST', body: data })), [start]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: await sessionBody() }).catch(() => {});
    await sessionStore.set(null);
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
    () => ({ user, status, config, needsVerification, login, loginSecondStep, register, logout, reloadUser, setUser }),
    [user, status, config, needsVerification, login, loginSecondStep, register, logout, reloadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
