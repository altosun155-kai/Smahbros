// useAuthGuard — React equivalent of web/public/js/auth.js's requireAuth().
// Unlike apiFetch()'s 401 handling (a reactive fallback that only fires once
// a call to the API actually 401s), this blocks the protected render up
// front: renders nothing until the token check resolves, so there's no flash
// of protected content before the redirect kicks in.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from './api';

export function useAuthGuard(): { checking: boolean; authed: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (getToken()) {
      setAuthed(true);
      setChecking(false);
      return;
    }
    // Same handoff auth.js's requireAuth() uses, so a login on the legacy
    // login.html page can send the player back to the Next.js route they
    // actually wanted.
    localStorage.setItem('loginReturnUrl', window.location.href);
    router.replace('/login.html');
    // Deliberately leave `checking` true -- the redirect is in flight, and
    // flipping it to false here would let the caller render its "not
    // authed" branch for one frame before navigation completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { checking, authed };
}
