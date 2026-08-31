// useServerReady — Phase 1 cold-start keep-warm. GET /health already exists
// (api.py:135); this is purely a client-side UX addition. Reuses the exact
// poll cadence already proven in login.html's waitForServer() and
// game-menu.js's ensureSummaryLoaded() (first retry at 2s, then every 10s,
// up to 10 attempts / ~90s) rather than inventing a new one, and reuses
// showToast's existing "waking up" toast (api.ts already special-cases and
// dedupes that message). New here: surfacing that toast specifically once
// ~4s have passed with no response yet, matching the ~4s threshold already
// documented in CLAUDE.md's Gotchas, instead of leaving the page silent
// while a Render cold start runs its ~30s course.
'use client';

import { useEffect } from 'react';
import { API_BASE, showToast } from './api';

const WAKEUP_TOAST_DELAY_MS = 4000;
const MAX_ATTEMPTS = 10;

export function useServerReady(opts: { skip?: boolean } = {}) {
  const { skip = false } = opts;

  useEffect(() => {
    // Public routes that run their own server-ready gate (currently just
    // /login -- see AuthGate.tsx) skip this poll entirely, rather than
    // running two concurrent /health loops with two slightly different
    // "server starting" notices stacked on top of each other.
    if (skip) return;

    let cancelled = false;
    let ready = false;

    const toastTimer = setTimeout(() => {
      if (!cancelled && !ready) {
        showToast('Server is waking up… this can take up to 30s.', 'warn', 30000);
      }
    }, WAKEUP_TOAST_DELAY_MS);

    (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
          if (res.ok) {
            ready = true;
            return;
          }
        } catch {
          // keep retrying -- same swallow as the legacy poll loops
        }
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 2000 : 10000));
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(toastTimer);
    };
  }, [skip]);
}
