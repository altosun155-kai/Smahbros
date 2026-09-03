// / (home) — port of web/public/index.html. This is page-mode only: the
// cinematic 3-column menu (champion background, detail panel, bounty
// posters) that web/public/js/game-menu.js renders via GameMenu.init({mode:
// 'page', ...}). The panel/poster rendering, summary types, and secondary
// item list live in lib/gameMenu.tsx, shared with GameMenuOverlay.tsx (mode:
// 'overlay', every other page's hamburger "Menu" button) so the two can't
// drift apart -- see CLAUDE.md's Known Gaps for the history here.
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PageContainer from './components/PageContainer';
import { apiGet, apiPatch, clearToken, showToast } from './lib/api';
import { charImgUrl } from './lib/chars';
import { clearSummaryCache, getCachedSummary, getPrimaryTop, loadSummary, PanelContent, PosterCard, SECONDARY, reducedMotion, type HomeSummary, type PanelKey } from './lib/gameMenu';
import { useDocumentTitle } from './lib/useDocumentTitle';
import '../public/css/game-menu.css';
import './index.css';

interface Invite {
  id: number;
  status: string;
  inviter: string;
  bracket_id: number;
  bracket_name: string | null;
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

export default function HomePage() {
  useDocumentTitle('Smash Bracket');
  const [me, setMe] = useState<{ username: string; avatar_url: string | null } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [summary, setSummary] = useState<HomeSummary | null>(() => getCachedSummary());
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [panelKey, setPanelKey] = useState<PanelKey>('primary');
  const [panelFading, setPanelFading] = useState(false);
  const homeRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    apiGet<{ username: string; avatar_url: string | null }>('/users/me')
      .then(setMe)
      .catch(() => {});
    apiGet<Invite[]>('/invites/received')
      .then((data) => setInvites((data || []).filter((i) => i.status === 'pending')))
      .catch(() => {});
  }, []);

  // loadSummary/getCachedSummary live in lib/gameMenu.tsx now -- shared with
  // GameMenuOverlay so navigating home -> overlay (or the reverse) doesn't
  // refire /home/summary just because a different component asked first.
  function fetchSummary(force = false) {
    loadSummary(force).then((s) => {
      setSummary(s);
      setSummaryFailed(!s);
    });
  }

  useEffect(() => {
    fetchSummary();
    function onVisible() {
      if (document.visibilityState === 'visible') fetchSummary(true);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse-driven parallax on the champion background -- desktop only, off
  // under prefers-reduced-motion. Direct style mutation (not React state) to
  // avoid a re-render on every mousemove, same reasoning as the original's
  // rAF-throttled version.
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth <= 700 || reducedMotion()) return;
    let rafPending = false;
    function onMouseMove(e: MouseEvent) {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const bg = bgRef.current;
        if (!bg) return;
        const xPct = (e.clientX / window.innerWidth - 0.5) * 2;
        const yPct = (e.clientY / window.innerHeight - 0.5) * 2;
        bg.style.transform = `scale(1.06) translate(${xPct * -1.5}%, ${yPct * -1.5}%)`;
      });
    }
    document.addEventListener('mousemove', onMouseMove);
    return () => document.removeEventListener('mousemove', onMouseMove);
  }, []);

  // Arrow-key nav across the unified primary+secondary item list.
  useEffect(() => {
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
  }, []);

  function showPanel(key: PanelKey) {
    setPanelFading(true);
    setTimeout(() => {
      setPanelKey(key);
      setPanelFading(false);
    }, 150);
  }

  async function dismissInvite(id: number) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    apiPatch(`/invites/${id}`, { status: 'declined' }).catch(() => {});
  }

  const primaryTop = getPrimaryTop(summary);

  return (
    <PageContainer style={{ paddingTop: 20 }}>
      <div id="mobileInviteBanner" className="mobile-only">
        {invites.map((inv) => (
          <div key={inv.id} className="mobile-invite-item">
            <div className="inv-dot" />
            <div className="inv-text">
              <div className="inv-by">From {inv.inviter}</div>
              <div className="inv-name">{inv.bracket_name}</div>
            </div>
            <Link href={`/tournament?id=${inv.bracket_id}`} className="inv-btn">
              View →
            </Link>
            <button type="button" className="inv-x" onClick={() => dismissInvite(inv.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <div className="desktop-only">
          <div className="section-label">🎟 Tournament Invites</div>
          <div>
            {invites.map((inv) => (
              <div key={inv.id} className="invite-card glass">
                <div className="invite-dot" />
                <div className="invite-info">
                  <div className="invite-from">Invited by {inv.inviter}</div>
                  <div className="invite-name">{inv.bracket_name}</div>
                </div>
                <div className="invite-actions">
                  <Link href={`/tournament?id=${inv.bracket_id}`} className="invite-view">
                    View →
                  </Link>
                  <button type="button" className="invite-dismiss" onClick={() => dismissInvite(inv.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={homeRef} className="home-shell">
        <div ref={bgRef} className="home-bg" style={summary?.background_character ? { backgroundImage: `url('${charImgUrl(summary.background_character)}')` } : undefined} />
        {summary?.champion && (
          <div className="home-elo-badge">
            <span>{summary.champion.player_elo}</span>
            <span className="home-elo-label">Elo</span>
          </div>
        )}
        {me && (
          <div className="home-identity">
            <img
              className="home-identity-avatar"
              src={me.avatar_url || fallbackAvatar(me.username)}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <span>{me.username}</span>
          </div>
        )}
        <div className="home-grid">
          <nav ref={menuRef} className="home-menu" aria-label="Home menu">
            <div className="home-menu-primary">
              <Link
                href={primaryTop.href}
                className="home-menu-item highlighted"
                onMouseEnter={() => showPanel('primary')}
                onFocus={() => showPanel('primary')}
              >
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
    </PageContainer>
  );
}
