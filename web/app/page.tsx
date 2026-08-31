// / (home) — port of web/public/index.html. This is page-mode only: the
// cinematic 3-column menu (champion background, detail panel, bounty
// posters) that web/public/js/game-menu.js renders via GameMenu.init({mode:
// 'page', ...}). Overlay mode (the same module driving every other page's
// hamburger "Menu" button) is NOT ported here -- see CLAUDE.md's Known Gaps.
// AppShell's Menu button stays a no-op until that's done as its own task.
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PageContainer from './components/PageContainer';
import { apiGet, apiPatch, clearToken, showToast } from './lib/api';
import { charImgUrl, SMASH_ROSTER } from './lib/chars';
import '../public/css/game-menu.css';
import './index.css';

interface Invite {
  id: number;
  status: string;
  inviter: string;
  bracket_id: number;
  bracket_name: string | null;
}

interface InProgress {
  type: 'bracket' | 'draft';
  id: number;
  name: string;
  round_or_progress: string;
  leader: string;
}

interface LastSession {
  name: string;
  winner: string;
  ended_at: string | null;
}

interface LastDuel {
  opponent: string;
  result: 'W' | 'L';
  record: string;
  played_at: string | null;
}

interface MyBrackets {
  count: number;
  most_recent: { id: number; name: string } | null;
}

interface Champion {
  username: string;
  character: string | null;
  player_elo: number;
}

interface Poster {
  winner: string;
  winner_char: string;
  winner_avatar: string | null;
  loser: string;
  loser_char: string;
  created_at: string;
}

interface HomeSummary {
  in_progress: InProgress | null;
  last_session: LastSession | null;
  last_duel: LastDuel | null;
  my_brackets: MyBrackets;
  champion: Champion | null;
  background_character: string | null;
  mastery_coverage: { played: number };
  posters: Poster[];
}

type PanelKey = 'primary' | 'duel' | 'my-brackets' | 'manual-bracket' | 'stats' | 'leaderboard' | 'mastery' | 'tier-list' | 'favorites' | 'profile' | 'signout';

const SECONDARY: { key: PanelKey; label: string; href: string }[] = [
  { key: 'my-brackets', label: 'My Brackets', href: '/my-brackets' },
  { key: 'manual-bracket', label: 'Manual Bracket', href: '/bracket' },
  { key: 'stats', label: 'Stats', href: '/stats' },
  { key: 'leaderboard', label: 'Leaderboard', href: '/leaderboard' },
  { key: 'mastery', label: 'Mastery', href: '/mastery' },
  { key: 'tier-list', label: 'Tier List', href: '/tier-list' },
  { key: 'favorites', label: 'Favorites', href: '/favorites' },
  { key: 'profile', label: 'Profile', href: '/profile' },
  { key: 'signout', label: 'Sign Out', href: '#' },
];

function timeAgoFrom(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function PanelContent({ panelKey, summary }: { panelKey: PanelKey; summary: HomeSummary | null }) {
  if (!summary) return <p className="home-panel-loading">Loading…</p>;

  if (panelKey === 'primary') {
    if (summary.in_progress) {
      const ip = summary.in_progress;
      const href = ip.type === 'draft' ? `/draft/${ip.id}` : `/tournament?id=${ip.id}`;
      return (
        <>
          <div className="home-panel-eyebrow">In Progress</div>
          <div className="home-panel-title">{ip.name}</div>
          <div className="home-panel-sub">
            {ip.round_or_progress || ''} · Host {ip.leader}
          </div>
          <Link href={href} className="btn btn-primary home-panel-cta">
            Continue →
          </Link>
        </>
      );
    }
    if (summary.last_session) {
      const ls = summary.last_session;
      return (
        <>
          <div className="home-panel-eyebrow">Last Session</div>
          <div className="home-panel-title">{ls.name}</div>
          <div className="home-panel-sub">
            {ls.winner} won · {timeAgoFrom(ls.ended_at)}
          </div>
          <Link href="/draft" className="btn btn-primary home-panel-cta">
            New Tournament →
          </Link>
        </>
      );
    }
    return (
      <>
        <div className="home-panel-eyebrow">Get Started</div>
        <div className="home-panel-title">Start your first tournament</div>
        <div className="home-panel-sub">Single-elimination with elo rewards.</div>
        <Link href="/draft" className="btn btn-primary home-panel-cta">
          New Tournament →
        </Link>
      </>
    );
  }

  if (panelKey === 'duel') {
    if (summary.last_duel) {
      const d = summary.last_duel;
      return (
        <>
          <div className="home-panel-eyebrow">1v1 Duel</div>
          <div className="home-panel-title">
            {d.result === 'W' ? 'Beat' : 'Lost to'} {d.opponent}
          </div>
          <div className="home-panel-sub">
            {d.record} · {timeAgoFrom(d.played_at)}
          </div>
          <Link href="/duel" className="btn btn-primary home-panel-cta">
            Play a Duel →
          </Link>
        </>
      );
    }
    return (
      <>
        <div className="home-panel-eyebrow">1v1 Duel</div>
        <div className="home-panel-title">Head-to-head</div>
        <div className="home-panel-sub">Live elo and stock multipliers.</div>
        <Link href="/duel" className="btn btn-primary home-panel-cta">
          Play a Duel →
        </Link>
      </>
    );
  }

  if (panelKey === 'my-brackets') {
    const mb = summary.my_brackets;
    const count = mb ? mb.count : 0;
    return (
      <>
        <div className="home-panel-eyebrow">My Brackets</div>
        <div className="home-panel-title">
          {count} tournament{count === 1 ? '' : 's'}
        </div>
        <div className="home-panel-sub">{mb && mb.most_recent ? `Most recent: ${mb.most_recent.name}` : 'None yet — start one from New Tournament.'}</div>
        <Link href="/my-brackets" className="btn btn-primary home-panel-cta">
          View My Brackets →
        </Link>
      </>
    );
  }

  if (panelKey === 'manual-bracket') {
    return (
      <>
        <div className="home-panel-eyebrow">Manual Bracket</div>
        <div className="home-panel-title">Build it by hand</div>
        <div className="home-panel-sub">Seed players and set matchups yourself — no draft, works great off one screen.</div>
        <Link href="/bracket" className="btn btn-primary home-panel-cta">
          Open Manual Bracket →
        </Link>
      </>
    );
  }

  if (panelKey === 'stats') {
    return (
      <>
        <div className="home-panel-eyebrow">Stats</div>
        <div className="home-panel-title">Your performance</div>
        <div className="home-panel-sub">Win rate, kills, and match history.</div>
        <Link href="/stats" className="btn btn-primary home-panel-cta">
          View Stats →
        </Link>
      </>
    );
  }

  if (panelKey === 'leaderboard') {
    const c = summary.champion;
    return (
      <>
        <div className="home-panel-eyebrow">Leaderboard</div>
        <div className="home-panel-title">{c ? c.username : 'No champion yet'}</div>
        <div className="home-panel-sub">{c ? `${c.player_elo} elo · ${c.character || '—'}` : 'Play a match to get on the board.'}</div>
        <Link href="/leaderboard" className="btn btn-primary home-panel-cta">
          View Leaderboard →
        </Link>
      </>
    );
  }

  if (panelKey === 'mastery') {
    const played = summary.mastery_coverage ? summary.mastery_coverage.played : 0;
    const total = SMASH_ROSTER.length;
    const pct = total ? Math.round((played / total) * 100) : 0;
    return (
      <>
        <div className="home-panel-eyebrow">Mastery</div>
        <div className="home-panel-title">
          {played}
          {total ? `/${total}` : ''} characters played
        </div>
        <div className="home-panel-sub">{total ? `${pct}% roster coverage` : 'Who owns each character.'}</div>
        <Link href="/mastery" className="btn btn-primary home-panel-cta">
          View Mastery →
        </Link>
      </>
    );
  }

  if (panelKey === 'tier-list') {
    return (
      <>
        <div className="home-panel-eyebrow">Tier List</div>
        <div className="home-panel-title">Rank the roster</div>
        <div className="home-panel-sub">Rank all fighters your way.</div>
        <Link href="/tier-list" className="btn btn-primary home-panel-cta">
          Open Tier List →
        </Link>
      </>
    );
  }

  if (panelKey === 'favorites') {
    return (
      <>
        <div className="home-panel-eyebrow">Favorites</div>
        <div className="home-panel-title">Your top picks</div>
        <div className="home-panel-sub">Top 10 for auto-fill.</div>
        <Link href="/favorites" className="btn btn-primary home-panel-cta">
          Open Favorites →
        </Link>
      </>
    );
  }

  if (panelKey === 'profile') {
    return (
      <>
        <div className="home-panel-eyebrow">Profile</div>
        <div className="home-panel-title">Your profile</div>
        <div className="home-panel-sub">Match history and badges.</div>
        <Link href="/profile" className="btn btn-primary home-panel-cta">
          Open Profile →
        </Link>
      </>
    );
  }

  if (panelKey === 'signout') {
    return (
      <>
        <div className="home-panel-eyebrow">Sign Out</div>
        <div className="home-panel-title">See you next time</div>
        <div className="home-panel-sub">Sign out of this session.</div>
      </>
    );
  }

  return null;
}

function PosterCard({ r }: { r: Poster }) {
  return (
    <>
      <div className="bounty-poster" style={{ backgroundImage: `url('${charImgUrl(r.winner_char)}')` }}>
        <div className="bp-top">
          <div className="bp-header">WANTED</div>
          <div className="bp-doa">☠ Dead or Alive ☠</div>
        </div>
        <div className="bp-bottom">
          <div className="bp-name">{r.winner}</div>
          <div className="bp-char">{r.winner_char}</div>
          <div className="bp-crime">3-Stocked {r.loser}</div>
          <div className="bp-time">{timeAgoFrom(r.created_at)}</div>
        </div>
      </div>
      <div className="bounty-poster tombstone-poster" style={{ backgroundImage: `url('${charImgUrl(r.loser_char)}')` }}>
        <div className="bp-top">
          <div className="bp-header">R.I.P.</div>
        </div>
        <div className="bp-bottom">
          <div className="bp-sublabel">Here lies</div>
          <div className="bp-name">{r.loser}</div>
          <div className="bp-char">{r.loser_char}</div>
          <div className="bp-crime">3-Stocked by {r.winner}</div>
          <div className="bp-time">{timeAgoFrom(r.created_at)}</div>
        </div>
      </div>
    </>
  );
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

export default function HomePage() {
  const [me, setMe] = useState<{ username: string; avatar_url: string | null } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
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

  async function loadSummary() {
    try {
      const s = await apiGet<HomeSummary>('/home/summary');
      setSummary(s);
      setSummaryFailed(false);
      if (s.background_character) new Image().src = charImgUrl(s.background_character); // warm the cache before it's shown
    } catch {
      setSummaryFailed(true);
    }
  }

  useEffect(() => {
    loadSummary();
    function onVisible() {
      if (document.visibilityState === 'visible') loadSummary();
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

  const primaryTop = summary?.in_progress
    ? {
        label: 'Continue',
        sub: summary.in_progress.name,
        href: summary.in_progress.type === 'draft' ? `/draft/${summary.in_progress.id}` : `/tournament?id=${summary.in_progress.id}`,
        context: `${summary.in_progress.round_or_progress || ''} · Host ${summary.in_progress.leader}`,
      }
    : {
        label: 'New Tournament',
        sub: 'Single-elimination with elo rewards.',
        href: '/draft',
        context: summary?.last_session ? `Last: ${summary.last_session.name} — ${summary.last_session.winner} won · ${timeAgoFrom(summary.last_session.ended_at)}` : '',
      };

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
