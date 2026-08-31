// useAuthGuard — React equivalent of web/public/js/auth.js's requireAuth().
// Unlike apiFetch()'s 401 handling (a reactive fallback that only fires once
// a call to the API actually 401s), this blocks the protected render up
// front: renders nothing until the token check resolves, so there's no flash
// of protected content before the redirect kicks in.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from './api';

export function useAuthGuard(opts: { skip?: boolean } = {}): { checking: boolean; authed: boolean } {
  const { skip = false } = opts;
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // Public routes (currently just /login -- see AuthGate.tsx) pass this in
    // so AuthGate can render them unconditionally. Without it, an
    // unauthenticated visit to /login would redirect to /login, set
    // loginReturnUrl to /login itself, and never resolve `authed` -- a
    // permanently blank page (confirmed against the real bug, not
    // theoretical: /login's own body was empty until this guard existed).
    if (skip) {
      setChecking(false);
      setAuthed(true);
      return;
    }
    if (getToken()) {
      setAuthed(true);
      setChecking(false);
      return;
    }
    // Same handoff auth.js's requireAuth() uses, so login can send the
    // player back to the Next.js route they actually wanted. Target is the
    // ported '/login' now that it exists (was '/login.html') -- every
    // useAuthGuard caller lives under web/app, so it should keep visitors
    // inside the Next app rather than bouncing them to the legacy page.
    localStorage.setItem('loginReturnUrl', window.location.href);
    router.replace('/login');
    // Deliberately leave `checking` true -- the redirect is in flight, and
    // flipping it to false here would let the caller render its "not
    // authed" branch for one frame before navigation completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  // Note: when skip=true, `authed` is true regardless of whether the visitor
  // actually holds a token -- it means "the guard passed/was bypassed", not
  // "this visitor is authenticated". Fine for AuthGate (the only caller),
  // which only ever uses it to decide whether to render null; a future
  // caller that needs real auth state should call getToken() directly
  // rather than trusting this field under skip.
  return { checking, authed };
}
