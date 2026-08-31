// AuthGate — the client-side wrapper RootLayout renders around every page.
// Combines useAuthGuard (blocks render + redirects unauthenticated visitors,
// same target as every legacy page's requireAuth()) with AppShell (the
// ported nav). Split out from layout.tsx because both the guard hook and
// AppShell need 'use client', and layout.tsx itself stays a server component.
'use client';

import type { ReactNode } from 'react';
import { useAuthGuard } from '../lib/useAuthGuard';
import { useServerReady } from '../lib/useServerReady';
import AppShell from './AppShell';

export default function AuthGate({ children }: { children: ReactNode }) {
  // Fires regardless of auth state -- a cold backend affects the login flow
  // just as much as anything behind the guard.
  useServerReady();
  const { checking, authed } = useAuthGuard();

  // Nothing rendered while the token check / redirect is in flight -- avoids
  // a flash of protected content, same intent as requireAuth()'s immediate
  // window.location.href swap.
  if (checking || !authed) return null;

  return (
    <>
      <AppShell />
      {children}
    </>
  );
}
