const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const API_BASE = `${API_ORIGIN}/api`;
// Socket.IO may live on a different origin than the API (e.g. API proxied through Vercel, sockets direct to Render).
export const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || API_ORIGIN || '').replace(/\/$/, '') || undefined; // undefined = same origin

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// The access token lives only in memory; the refresh token is an httpOnly cookie.
let accessToken = null;
let refreshing = null;
const listeners = new Set();

export const getAccessToken = () => accessToken;
export function setSession(token, user) {
  accessToken = token;
  listeners.forEach((fn) => fn(user ?? null, token));
}
export const onSessionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function tokenExpiresInMs(token) {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

/** Single-flight refresh: concurrent callers share one request (refresh tokens rotate). */
export function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSession(null, null);
          throw new ApiError(res.status, body.error?.code || 'unauthorized', body.error?.message || 'Session expired');
        }
        setSession(body.accessToken, body.user);
        return body;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** Returns an access token with at least 60 s of life left. */
export async function freshAccessToken() {
  if (accessToken && tokenExpiresInMs(accessToken) > 60_000) return accessToken;
  const { accessToken: t } = await refreshSession();
  return t;
}

export async function api(path, { method = 'GET', body, retry = true } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Network error. Check your connection and try again.');
  }

  if (res.status === 401 && retry && accessToken && !path.startsWith('/auth/login')) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.error?.code === 'invalid_token' || data.error?.code === 'unauthorized') {
      await refreshSession();
      return api(path, { method, body, retry: false });
    }
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    // A non-JSON error means the request never reached our API (e.g. a hosting proxy/rewrite is misconfigured).
    const fallback = isJson ? `Request failed (${res.status})` : `Can't reach the server (HTTP ${res.status}). The app's API connection is misconfigured or the server is starting up; try again in a minute.`;
    throw new ApiError(res.status, data.error?.code || (isJson ? 'error' : 'api_unreachable'), data.error?.message || fallback, data.error?.details);
  }
  return data;
}
