// api.js — shared API helper for Smash Bracket
// All calls go through apiFetch. 502 retry logic with toast notification.

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20000;

// ── Toast helper (used for 502 wakeup message) ────
function _showToast(message, type = 'info', duration = 5000) {
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
  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
  return toast;
}

// ── Core fetch with 502 retry ─────────────────────
async function apiFetch(method, path, body = null, auth = true) {
  const headers = {};

  if (auth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
  }

  // Body handling
  let requestBody = undefined;
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
      const waitSec = 20;
      const toast = _showToast(
        `API is waking up… retrying in ${waitSec}s (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
        'warn',
        waitSec * 1000
      );
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: requestBody,
      });
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS - 1) {
        throw new Error('Network error: could not reach the API. Check your connection.');
      }
      continue;
    }

    if (res.status === 502 && attempt < RETRY_ATTEMPTS - 1) {
      continue;
    }

    if (res.status === 401) {
      clearToken();
      window.location.href = 'login.html';
      throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        detail = errData.detail || errData.message || JSON.stringify(errData);
      } catch (_) {
        try { detail = await res.text() || detail; } catch (_) {}
      }
      throw new Error(detail);
    }

    // 204 No Content
    if (res.status === 204) return null;

    return await res.json();
  }

  throw new Error('API is unavailable after multiple retries. Please try again later.');
}

// ── Convenience wrappers ──────────────────────────
async function apiGet(path, auth = true) {
  return apiFetch('GET', path, null, auth);
}

async function apiPost(path, body, auth = true) {
  return apiFetch('POST', path, body, auth);
}

async function apiPut(path, body, auth = true) {
  return apiFetch('PUT', path, body, auth);
}

async function apiPatch(path, body, auth = true) {
  return apiFetch('PATCH', path, body, auth);
}

async function apiDelete(path, auth = true) {
  return apiFetch('DELETE', path, null, auth);
}

// ── Toast shortcut for page-level use ─────────────
function showToast(message, type = 'info', duration = 4000) {
  return _showToast(message, type, duration);
}
