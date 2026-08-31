// AuthGate — the client-side wrapper RootLayout renders around every page.
// Combines useAuthGuard (blocks render + redirects unauthenticated visitors,
// same target as every legacy page's requireAuth()) with AppShell (the
// ported nav). Split out from layout.tsx because both the guard hook and
// AppShell need 'use client', and layout.tsx itself stays a server component.
'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthGuard } from '../lib/useAuthGuard';
import { useServerReady } from '../lib/useServerReady';
import AppShell from './AppShell';

// Routes that must render regardless of auth state. Currently just /login:
// it's reachable by definition (an unauthenticated visitor has to be able to
// land on it), and it owns its own layout -- no shared nav, matching
// web/public/login.html not loading nav-inject.js either.
const PUBLIC_ROUTES = ['/login'];

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.includes(pathname);

  // Public routes run their own server-ready gate (see login/page.tsx's
  // waitForServer-equivalent) -- skip here too, so /login doesn't run two
  // concurrent /health polls with two "server starting" notices stacked.
  useServerReady({ skip: isPublic });
  const { checking, authed } = useAuthGuard({ skip: isPublic });

  if (isPublic) return <>{children}</>;

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
