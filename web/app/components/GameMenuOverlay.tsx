// GameMenuOverlay — React port of web/public/js/game-menu.js's mode:
// 'overlay' (backdrop + dialog wrapping the same .home-shell markup as the
// home page). Content (panel/poster rendering, summary fetch+cache, the
// secondary item list) comes from lib/gameMenu.tsx, shared with
// web/app/page.tsx's mode:'page' render -- see that file's header comment.
// Rendered once by AppShell, controlled via `open`/`onClose` so AppShell's
// existing "Menu" button trigger just flips a boolean instead of reaching
// into a vanilla-JS-style singleton.
'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import Link from 'next/link';
import { charImgUrl } from '../lib/chars';
import { clearToken } from '../lib/api';
import { clearSummaryCache, getCachedSummary, getPrimaryTop, loadSummary, PanelContent, PosterCard, reducedMotion, SECONDARY, type HomeSummary, type PanelKey } from '../lib/gameMenu';

const CLOSE_TRANSITION_MS = 200; // matches game-menu.css's #gameMenuBackdrop/#gameMenuPanel transition durations

interface GameMenuOverlayProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}

// Heuristic, not a universal modal-stack manager -- mirrors game-menu.js's
// own isOtherModalOpen() exactly. Every modal in this app (Modal.tsx-based
// and the few bespoke ones) renders a real role="dialog" element only while
// open, so "something else is open" is answered by finding any such element
// that isn't this overlay's own panel.
function isOtherDialogOpen() {
  return !!document.querySelector('[role="dialog"]:not([data-game-menu-panel])');
}

export default function GameMenuOverlay({ open, onClose, triggerRef }: GameMenuOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [animateOpen, setAnimateOpen] = useState(false);
  const [summary, setSummary] = useState<HomeSummary | null>(() => getCachedSummary());
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [panelKey, setPanelKey] = useState<PanelKey>('primary');
  const [panelFading, setPanelFading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const scrollLockRef = useRef<{ overflow: string; paddingRight: string } | null>(null);

  // Mount / unmount + open/close transition, mirroring game-menu.js's own
  // open()/close(): the panel stays in the DOM for the fade-out instead of
  // vanishing the instant `open` flips false.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setAnimateOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    if (!mounted) return;
    setAnimateOpen(false);
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const t = setTimeout(() => setMounted(false), CLOSE_TRANSITION_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch on first open, cached across opens for the session; the home page
  // shares the same cache (lib/gameMenu.tsx) so whichever mounts first is the
  // only one that actually hits the network.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadSummary().then((s) => {
      if (cancelled) return;
      setSummary(s);
      setSummaryFailed(!s);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      loadSummary(true).then((s) => {
        setSummary(s);
        setSummaryFailed(!s);
      });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [open]);

  // Body scroll lock, restored on close. Padding-right compensation avoids
  // the layout jump from the scrollbar disappearing; not touching scrollTop
  // means the page is exactly where it was once the lock lifts.
  useEffect(() => {
    if (!mounted) return;
    const body = document.body;
    scrollLockRef.current = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      const prev = scrollLockRef.current;
      body.style.overflow = prev?.overflow ?? '';
      body.style.paddingRight = prev?.paddingRight ?? '';
      scrollLockRef.current = null;
    };
  }, [mounted]);

  // Focus: first focusable item on open, trapped inside while open, returned
  // to the trigger on close.
  useEffect(() => {
    if (!mounted || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    focusable()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Escape closes -- but yields to any other open dialog first, so
  // dismissing a modal opened from inside/over the menu doesn't also close
  // the menu underneath it in the same keypress.
  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (isOtherDialogOpen()) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mounted, onClose]);

  // Arrow-key nav across the unified primary+secondary item list, same as
  // the home page's own copy of this behavior.
  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !menuRef.current || !menuRef.current.contains(active)) return;
      const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('.home-menu-item, .home-menu-secondary-item'));
      const idx = items.indexOf(active);
      if (idx === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? items[idx + 1] || items[0] : items[idx - 1] || items[items.length - 1];
      next.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mounted]);

  function showPanel(key: PanelKey) {
    setPanelFading(true);
    setTimeout(() => {
      setPanelKey(key);
      setPanelFading(false);
    }, 150);
  }

  // Any link inside the overlay must visually disappear before Next's router
  // continues the navigation -- with View Transitions on, a still-visible
  // overlay gets captured in the outgoing snapshot and ghosts into the next
  // page. onClickCapture runs before the target's own onClick (which is what
  // actually calls router.push, or for Sign Out's plain <a>, calls
  // preventDefault() and does the redirect itself), so this lands before
  // that happens rather than racing it.
  //
  // This used to call flushSync to unmount the overlay (setMounted(false))
  // right here in the capture phase -- that's wrong, not just heavy-handed:
  // it tears the DOM node out from under React's own fiber tree before the
  // target's bubble-phase onClick ever runs, so React can no longer find a
  // handler to call. For a real <Link> that's invisible-but-still-broken --
  // the browser's native default anchor action still fires since
  // preventDefault() was never reached, so it looks like normal navigation
  // but is actually a full page reload, not Next's soft client transition.
  // For Sign Out's `href="#"`, there's no useful default action at all, so
  // clicking it silently did nothing (confirmed live: URL gained a stray
  // `#`, session stayed logged in). Direct style mutation instead -- hides
  // the backdrop for the View Transition snapshot without touching React's
  // tree, so the target's own onClick still runs normally afterward. The
  // real unmount still happens, just through the ordinary onClose() ->
  // `open` effect path a moment later.
  function handlePanelClickCapture(e: ReactMouseEvent) {
    if (!(e.target as HTMLElement).closest('a[href]')) return;
    // Cmd/ctrl-click and middle-click open the link in a new tab -- the
    // current page never navigates, so dismissing here would close the menu
    // out from under someone still looking at it.
    if (e.metaKey || e.ctrlKey || e.button === 1) return;
    if (backdropRef.current) backdropRef.current.style.display = 'none';
    onClose();
  }

  if (!mounted) return null;

  const primaryTop = getPrimaryTop(summary);

  return (
    <div
      id="gameMenuBackdrop"
      ref={backdropRef}
      className={animateOpen ? 'open' : ''}
      style={{ display: 'flex' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="gameMenuPanel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Main menu" data-game-menu-panel onClickCapture={handlePanelClickCapture}>
        <div className="home-shell">
          <div className="home-bg" style={summary?.background_character ? { backgroundImage: `url('${charImgUrl(summary.background_character)}')` } : undefined} />
          {summary?.champion && (
            <div className="home-elo-badge">
              <span>{summary.champion.player_elo}</span>
              <span className="home-elo-label">Elo</span>
            </div>
          )}
          <div className="home-grid">
            <nav ref={menuRef} className="home-menu" aria-label="Home menu">
              <div className="home-menu-primary">
                <Link href={primaryTop.href} className="home-menu-item highlighted" onMouseEnter={() => showPanel('primary')} onFocus={() => showPanel('primary')}>
                  {primaryTop.label}
                  <span className="hmi-sub">{primaryTop.sub}</span>
                  {primaryTop.context && <span className="hmi-context">{primaryTop.context}</span>}
                </Link>
                <Link href="/duel" className="home-menu-item" onMouseEnter={() => showPanel('duel')} onFocus={() => showPanel('duel')}>
                  1v1 Duel
                  <span className="hmi-sub">Head-to-head with live elo.</span>
                </Link>
              </div>
              <div className="home-menu-secondary">
                {SECONDARY.map((item) =>
                  item.key === 'signout' ? (
                    <a
                      key={item.key}
                      href="#"
                      className="home-menu-secondary-item"
                      onMouseEnter={() => showPanel(item.key)}
                      onFocus={() => showPanel(item.key)}
                      onClick={(e) => {
                        e.preventDefault();
                        onClose();
                        clearToken();
                        clearSummaryCache();
                        window.location.href = '/login';
                      }}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link key={item.key} href={item.href} className="home-menu-secondary-item" onMouseEnter={() => showPanel(item.key)} onFocus={() => showPanel(item.key)}>
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            </nav>
            <div className="home-panel">
              <div className={`home-panel-content${panelFading ? ' fading' : ''}`}>{summaryFailed ? <p className="home-panel-loading">Could not load home data.</p> : <PanelContent panelKey={panelKey} summary={summary} />}</div>
            </div>
            <div className="home-posters">
              {summary && summary.posters.length > 0 ? (
                summary.posters.map((r, i) => <PosterCard key={i} r={r} />)
              ) : summary ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No 3-stocks yet — stay strapped.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
