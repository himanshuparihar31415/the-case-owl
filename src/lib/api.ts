const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: async <T>(path: string, data: FormData): Promise<T> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: data });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { code: body.code as string | undefined });
    }
    return res.json() as Promise<T>;
  },
};

// Backend host used for the voice WebSocket in production. The WS must hit
// Railway directly — Vercel rewrites don't proxy WebSocket upgrades, so going
// through the Vercel domain fails with close code 1006. VITE_API_URL overrides
// this when set.
const PROD_BACKEND_HOST = 'casecoachaiv1-production.up.railway.app';

export function getWsUrl(path: string, params: Record<string, string> = {}): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let base: string;
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) {
    // Normalize whatever format VITE_API_URL is in to an absolute wss:// URL
    if (/^wss?:\/\//.test(apiUrl)) {
      base = apiUrl; // already ws/wss
    } else if (/^https?:\/\//.test(apiUrl)) {
      base = apiUrl.replace(/^https?/, wsProtocol); // http(s) → ws(s)
    } else if (apiUrl.startsWith('//')) {
      base = `${wsProtocol}:${apiUrl}`; // protocol-relative
    } else {
      base = `${wsProtocol}://${apiUrl}`; // bare hostname
    }
  } else if (/^(localhost|127\.0\.0\.1)/.test(window.location.host)) {
    // Local dev: the same server serves the API + WS.
    base = `${wsProtocol}://${window.location.host}`;
  } else {
    // Production: connect straight to the backend, not the Vercel frontend host.
    base = `${wsProtocol}://${PROD_BACKEND_HOST}`;
  }
  const token = getToken();
  const allParams = { ...(token ? { token } : {}), ...params };
  const qs = new URLSearchParams(allParams).toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}
