// useDocumentTitle — sets the browser tab title from a client component.
// Every web/app/*/page.tsx is 'use client' (data-fetching, WebSocket state,
// interactive UI throughout), so none can export the server-only `metadata`
// object Next.js otherwise uses for per-route <title> tags. This hook is a
// client-side patch, not a full fix -- see CLAUDE.md's Known Gaps for what
// it doesn't cover (the server-rendered <title> staying generic for anything
// that reads the HTML without executing JS). The real fix is a
// server-component wrapper per route exporting `metadata`, deferred as its
// own task.
//
// The MutationObserver below is NOT decorative. Confirmed live (Playwright):
// a plain `document.title = title` in a useEffect gets set correctly, then
// silently overwritten back to the root layout's generic title ~100ms later
// by Next 16's own client-rendered <title> element (part of its
// streaming-metadata machinery, which re-renders once shortly after mount
// even on a statically-prerendered route). Without re-asserting after that
// happens, every route's tab title reverts to "Smash Bracket" in practice --
// not a rare edge case, it reproduced on every single page tested. Observing
// document.head and re-applying our title whenever it drifts is what
// actually keeps it showing.
'use client';

import { useEffect } from 'react';

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
    const observer = new MutationObserver(() => {
      if (document.title !== title) {
        document.title = title;
      }
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
