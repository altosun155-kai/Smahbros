// api.ts — TS port of web/public/js/api.js + the token helpers from auth.js.
// Kept behaviorally identical (same retry/backoff, same toast classes) so the
// React side matches the vanilla pages exactly.

// Fetches go through our own origin (proxied to Render via next.config.js's
// rewrites) so they're invisible to ad blockers / Brave Shields, which kill
// cross-site requests to the Render domain outright. WebSocket connections
// still need the real origin -- Next.js rewrites don't reliably proxy WS
// upgrades -- so wsUrl() deliberately does not go through API_BASE.
export const API_BASE = '/api';
const WS_ORIGIN = 'https://smash-bracket-api.onrender.com';

export function wsUrl(path: string): string {
  return WS_ORIGIN.replace(/^http/, 'ws') + path;
}

const RETRY_ATTEMPTS = 3;

// ── Token management ──────────────────────────────
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('authToken');
}

export function getUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('username');
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('authToken');
  localStorage.removeItem('username');
}

// ── Toast helper (used for 502 wakeup message) ────
let _wakeupToast: HTMLElement | null = null;

export function showToast(message: string, type: string = 'info', duration: number = 4000): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;

  if (message.includes('waking up') && _wakeupToast && _wakeupToast.isConnected) {
    _wakeupToast.textContent = message;
    return _wakeupToast;
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    if (_wakeupToast === toast) _wakeupToast = null;
    setTimeout(() => toast.remove(), 300);
  }, duration);

  if (message.includes('waking up')) _wakeupToast = toast;
  return toast;
}

// ── Core fetch with 502 retry ─────────────────────
async function apiFetch<T = any>(method: string, path: string, body: unknown = null, auth: boolean = true): Promise<T> {
  const headers: Record<string, string> = {};

  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
  }

  let requestBody: BodyInit | undefined = undefined;
  if (body !== null) {
    if (body instanceof URLSearchParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      requestBody = body;
    } else {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
  }

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const waitSec = 25;
      showToast(`API is waking up… retrying (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`, 'warn', waitSec * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
    }

    let res: Response;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: requestBody });
    } catch (err) {
      if (attempt < RETRY_ATTEMPTS - 1) {
        const waitSec = 25;
        showToast(`API is waking up… retrying (attempt ${attempt + 2}/${RETRY_ATTEMPTS})`, 'warn', waitSec * 1000);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      throw new Error('Could not reach the API. It may still be waking up — please try again in a moment.');
    }

    if (res.status === 502 && attempt < RETRY_ATTEMPTS - 1) continue;

    if (res.status === 401) {
      clearToken();
      if (typeof window !== 'undefined') window.location.href = '/login.html';
      throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        detail = errData.detail || errData.message || JSON.stringify(errData);
      } catch (_) {
        try {
          detail = (await res.text()) || detail;
        } catch (_) {}
      }
      throw new Error(detail);
    }

    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }

  throw new Error('API is unavailable after multiple retries. Please try again later.');
}

export function apiGet<T = any>(path: string, auth: boolean = true): Promise<T> {
  return apiFetch<T>('GET', path, null, auth);
}

export function apiPost<T = any>(path: string, body?: unknown, auth: boolean = true): Promise<T> {
  return apiFetch<T>('POST', path, body ?? null, auth);
}

export function apiPut<T = any>(path: string, body?: unknown, auth: boolean = true): Promise<T> {
  return apiFetch<T>('PUT', path, body ?? null, auth);
}

export function apiPatch<T = any>(path: string, body?: unknown, auth: boolean = true): Promise<T> {
  return apiFetch<T>('PATCH', path, body ?? null, auth);
}

export function apiDelete<T = any>(path: string, auth: boolean = true): Promise<T> {
  return apiFetch<T>('DELETE', path, null, auth);
}
