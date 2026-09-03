// gameMenu.tsx — shared cinematic-menu content, ported from
// web/public/js/game-menu.js's panelContentFor/posterHtml/SECONDARY/
// DEFAULT_PRIMARY. One copy of the summary types, the panel/poster
// rendering, and the summary fetch-and-cache logic, used by BOTH
// web/app/page.tsx (mode: 'page', renders this inline) and
// GameMenuOverlay.tsx (mode: 'overlay', every other page's Menu button) --
// see CLAUDE.md's Known Gaps on why this used to be page-only and the
// shared-state-across-surfaces failure mode this file exists to avoid.
import Link from 'next/link';
import { apiGet } from './api';
import { charImgUrl, SMASH_ROSTER } from './chars';

export interface InProgress {
  type: 'bracket' | 'draft';
  id: number;
  name: string;
  round_or_progress: string;
  leader: string;
}

export interface LastSession {
  name: string;
  winner: string;
  ended_at: string | null;
}

export interface LastDuel {
  opponent: string;
  result: 'W' | 'L';
  record: string;
  played_at: string | null;
}

export interface MyBrackets {
  count: number;
  most_recent: { id: number; name: string } | null;
}

export interface Champion {
  username: string;
  character: string | null;
  player_elo: number;
}

export interface Poster {
  winner: string;
  winner_char: string;
  winner_avatar: string | null;
  loser: string;
  loser_char: string;
  created_at: string;
}

export interface HomeSummary {
  in_progress: InProgress | null;
  last_session: LastSession | null;
  last_duel: LastDuel | null;
  my_brackets: MyBrackets;
  champion: Champion | null;
  background_character: string | null;
  mastery_coverage: { played: number };
  posters: Poster[];
}

export type PanelKey = 'primary' | 'duel' | 'my-brackets' | 'manual-bracket' | 'stats' | 'leaderboard' | 'mastery' | 'tier-list' | 'favorites' | 'profile' | 'signout';

export const SECONDARY: { key: PanelKey; label: string; href: string }[] = [
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

export function timeAgoFrom(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The primary slot's label/href/context — "Continue" when a tournament/draft
// is live, else "New Tournament" with a "Last: ..." context line if there's
// a finished session to reference. Used by the primary menu item itself
// (both modes) and mirrors game-menu.js's renderSummary() computation
// exactly; summary undefined/null falls back to the same always-clickable
// default the vanilla module renders before /home/summary resolves.
export function getPrimaryTop(summary: HomeSummary | null) {
  if (summary?.in_progress) {
    const ip = summary.in_progress;
    return {
      label: 'Continue',
      sub: ip.name,
      href: ip.type === 'draft' ? `/draft/${ip.id}` : `/tournament?id=${ip.id}`,
      context: `${ip.round_or_progress || ''} · Host ${ip.leader}`,
    };
  }
  return {
    label: 'New Tournament',
    sub: 'Single-elimination with elo rewards.',
    href: '/draft',
    context: summary?.last_session ? `Last: ${summary.last_session.name} — ${summary.last_session.winner} won · ${timeAgoFrom(summary.last_session.ended_at)}` : '',
  };
}

export function PanelContent({ panelKey, summary }: { panelKey: PanelKey; summary: HomeSummary | null }) {
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

export function PosterCard({ r }: { r: Poster }) {
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

// ── Summary fetch + cache ──────────────────────────────
// Module-scope singleton, same intent as game-menu.js's own summaryPromise:
// fetched at most once per page-load session regardless of how many times
// the overlay is opened or the home page remounts, refetched only on an
// explicit visibilitychange (see both callers) or getSummary(true). Shared
// across the home page and the overlay so opening the overlay right after
// visiting home doesn't refire the same request home already made.
let summaryCache: HomeSummary | null = null;
let summaryPromise: Promise<HomeSummary | null> | null = null;

export function getCachedSummary(): HomeSummary | null {
  return summaryCache;
}

// Must be called on sign-out, alongside clearToken() -- this cache is
// per-browser-session, not per-user, so signing out and back in as someone
// else without a hard reload would otherwise show the previous account's
// in-progress tournament, last session, and posters until the next
// visibilitychange refetch.
export function clearSummaryCache(): void {
  summaryCache = null;
  summaryPromise = null;
}

export function loadSummary(force = false): Promise<HomeSummary | null> {
  if (force) summaryPromise = null;
  if (!summaryPromise) {
    summaryPromise = apiGet<HomeSummary>('/home/summary')
      .then((s) => {
        summaryCache = s;
        if (s.background_character) new Image().src = charImgUrl(s.background_character); // warm the cache before it's ever shown
        return s;
      })
      .catch(() => {
        summaryCache = null;
        return null;
      });
  }
  return summaryPromise;
}
