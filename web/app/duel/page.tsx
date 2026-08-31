// /duel — port of web/public/duel.html. Player/avatar pickers, H2H + matchup
// preview, Elo-delta preview math (mirrors routers/matches.py's _k_factor/
// _elo_change exactly, verified against the actual backend formulas), an
// open-ended running series score, and a game log with a GSAP Elo-counter.
//
// Two things intentionally NOT ported, per CLAUDE.md's Known Gaps:
// - The "Series Winner" banner: seriesWinner is never set truthy anywhere in
//   the legacy file, so it never fires there either. Dropped rather than
//   wired to nothing.
// - recordGame() calls POST /matches/record without a bracket_id, which
//   403s for any non-admin user (confirmed against the real backend). This
//   port reproduces that exact call/behavior rather than fixing it -- a
//   decision for its own task, not this migration.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, apiPost, showToast } from '../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../lib/chars';
import { winPctColor } from '../lib/colorUtils';
import { BadgePill, loadAllBadges, type BadgeInfo } from '../lib/badges';
import './duel.css';

interface UserRow {
  username: string;
  avatar_url: string | null;
}

interface CharStat {
  character: string;
  elo?: number;
  wins?: number;
  losses?: number;
  kills?: number;
  points?: number;
}

interface H2HData {
  user1_wins?: number;
  user2_wins?: number;
  total?: number;
  leader?: string | null;
  matchups?: Record<string, { user1_wins: number; user2_wins: number }>;
}

interface EloLbRow {
  username: string;
  character: string;
  elo?: number;
}

interface GameEntry {
  winner: 1 | 2;
  winnerPlayer: string;
  loserPlayer: string;
  winnerChar: string;
  loserChar: string;
  wk: number;
  lk: number;
  eloDelta: number;
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

// ── Elo preview math -- mirrors routers/matches.py's _k_factor/_mov_multiplier
// /_elo_change exactly (verified against the real backend source). Only ever
// called with winner-stock margins of 3-0/3-1/3-2 (diff 3/2/1), same as the
// legacy page, so the simpler diff>=3/===2/else-1.25 ladder below always
// agrees with the backend's more general 1.0 + diff*0.25 formula.
function kFactor(rank: number): number {
  if (rank <= 10) return 20;
  if (rank <= 25) return 30;
  return 50;
}

function duelEloDeltas(winnerElo: number, loserElo: number, wk: number, lk: number, winnerRank: number, loserRank: number) {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const diff = wk - lk;
  const mov = diff >= 3 ? 2.0 : diff === 2 ? 1.5 : 1.25;
  const surprise = 1 - expected;
  return {
    winner: Math.max(1, Math.round(kFactor(winnerRank) * surprise * mov)),
    loser: Math.max(1, Math.round(kFactor(loserRank) * surprise * mov)),
  };
}

function rankAfter(lb: EloLbRow[], username: string, character: string, newElo: number): number {
  let rank = 1;
  for (const e of lb) {
    if (e.username === username && e.character === character) continue;
    if ((e.elo || 1000) > newElo) rank++;
  }
  return rank;
}

// ── Searchable character picker -- port of the _pickerVal/_renderDrop/
// openPicker/closePicker/selectPicker/pickerKey cluster. `value` is the
// confirmed selection (owned by the parent); `text` is what's actually
// typed, reverted to `value` on blur if it isn't a real roster entry.
function CharPicker({ value, onSelect, style }: { value: string; onSelect: (char: string) => void; style?: React.CSSProperties }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const q = text.toLowerCase();
  const matches = SMASH_ROSTER.filter((c) => !q || c.toLowerCase().includes(q));

  function selectChar(char: string) {
    setText(char);
    setOpen(false);
    onSelect(char);
  }

  return (
    <div className="char-picker" style={style}>
      <input
        type="text"
        placeholder="Search character…"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setOpen(false);
            if (!SMASH_ROSTER.includes(text)) setText(value);
          }, 160);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % matches.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && matches[activeIdx]) selectChar(matches[activeIdx]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <div className={`char-dropdown${open ? ' open' : ''}`}>
        {matches.length ? (
          matches.map((c, i) => (
            <div key={c} className={`char-option${i === activeIdx ? ' active' : ''}`} onMouseDown={() => selectChar(c)}>
              {c}
            </div>
          ))
        ) : (
          <div className="char-option no-match">No results</div>
        )}
      </div>
    </div>
  );
}

export default function DuelPage() {
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [badges, setBadges] = useState<Record<string, BadgeInfo>>({});

  const [selectedP1, setSelectedP1] = useState('');
  const [selectedP2, setSelectedP2] = useState('');
  const [p1CharSetup, setP1CharSetup] = useState('');
  const [p2CharSetup, setP2CharSetup] = useState('');

  const [h2h, setH2h] = useState<H2HData | null>(null);
  const [p1Stats, setP1Stats] = useState<CharStat[]>([]);
  const [p2Stats, setP2Stats] = useState<CharStat[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [seriesActive, setSeriesActive] = useState(false);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [games, setGames] = useState<GameEntry[]>([]);
  const [gameP1Char, setGameP1Char] = useState('');
  const [gameP2Char, setGameP2Char] = useState('');
  const [lbCache, setLbCache] = useState<EloLbRow[] | null>(null);
  const [liveEloDelta, setLiveEloDelta] = useState<number | null>(null);

  const avFallback = fallbackAvatar;

  useEffect(() => {
    (async () => {
      try {
        const [users, me] = await Promise.all([apiGet<UserRow[]>('/users/all'), apiGet<{ username: string }>('/users/me'), loadAllBadges().then(setBadges)]);
        setAllUsers(users || []);
        setMyUsername(me?.username || null);
        if (me?.username) setSelectedP1(me.username);
        const vsParam = new URLSearchParams(window.location.search).get('vs');
        if (vsParam && (users || []).find((u) => u.username === vsParam)) {
          setSelectedP2(vsParam);
        }
      } catch {
        showToast('Failed to load users', 'error');
      }
    })();
  }, []);

  // ── Preview panel (H2H, matchup, per-player char stats) ──────────────────
  useEffect(() => {
    if (!selectedP1 || !selectedP2 || selectedP1 === selectedP2) return;
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      const [h, s1, s2] = await Promise.allSettled([
        apiGet<H2HData>(`/users/${encodeURIComponent(selectedP1)}/h2h/${encodeURIComponent(selectedP2)}`),
        apiGet<{ stats: CharStat[] }>(`/characters/stats/${encodeURIComponent(selectedP1)}`),
        apiGet<{ stats: CharStat[] }>(`/characters/stats/${encodeURIComponent(selectedP2)}`),
      ]);
      if (cancelled) return;
      setH2h(h.status === 'fulfilled' ? h.value : null);
      setP1Stats(s1.status === 'fulfilled' ? s1.value.stats || [] : []);
      setP2Stats(s2.status === 'fulfilled' ? s2.value.stats || [] : []);
      setPreviewLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedP1, selectedP2]);

  function getElo(stats: CharStat[], character: string): number {
    const row = stats.find((s) => s.character === character);
    return row?.elo || 1000;
  }

  const showPreview = !!selectedP1 && !!selectedP2 && selectedP1 !== selectedP2;

  const matchup = useMemo(() => {
    if (!p1CharSetup || !p2CharSetup || !h2h) return null;
    const key = `${p1CharSetup} vs ${p2CharSetup}`;
    return h2h.matchups?.[key] || null;
  }, [p1CharSetup, p2CharSetup, h2h]);

  const underdogSide = useMemo(() => {
    if (!p1CharSetup || !p2CharSetup) return null;
    const e1 = getElo(p1Stats, p1CharSetup);
    const e2 = getElo(p2Stats, p2CharSetup);
    if (Math.abs(e1 - e2) >= 150) return e1 < e2 ? 'p1' : 'p2';
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1CharSetup, p2CharSetup, p1Stats, p2Stats]);

  async function quickStart(slot: 'p1' | 'p2') {
    const username = slot === 'p1' ? selectedP1 : selectedP2;
    if (!username) return;
    try {
      const data = await apiGet<{ stats?: CharStat[] } | CharStat[]>(`/characters/stats/${encodeURIComponent(username)}`);
      const rows = Array.isArray(data) ? data : data.stats || [];
      const sorted = rows.filter((s) => (s.wins || 0) + (s.losses || 0) > 0).sort((a, b) => (b.elo || 1000) - (a.elo || 1000));
      if (sorted.length) {
        if (slot === 'p1') setP1CharSetup(sorted[0].character);
        else setP2CharSetup(sorted[0].character);
        showToast(`Auto-filled ${sorted[0].character} (top Elo)`, 'success');
      }
    } catch {
      // same silent catch as the original
    }
  }

  function startSeries() {
    try {
      navigator.vibrate?.([8]);
    } catch {
      // ignore
    }
    if (!selectedP1 || !selectedP2) {
      showToast('Select both players', 'warn');
      return;
    }
    if (selectedP1 === selectedP2) {
      showToast('Players must be different', 'warn');
      return;
    }
    if (!p1CharSetup || !p2CharSetup) {
      showToast('Select characters for both players', 'warn');
      return;
    }
    setP1(selectedP1);
    setP2(selectedP2);
    setP1Score(0);
    setP2Score(0);
    setGames([]);
    setGameP1Char(p1CharSetup);
    setGameP2Char(p2CharSetup);
    setLbCache(null);
    setLiveEloDelta(null);
    setSeriesActive(true);
  }

  async function fetchLb(): Promise<EloLbRow[]> {
    if (lbCache !== null) return lbCache;
    try {
      const lb = await apiGet<EloLbRow[]>('/characters/stats/leaderboard/elo');
      setLbCache(lb);
      return lb;
    } catch {
      setLbCache([]);
      return [];
    }
  }

  const [eloPreview, setEloPreview] = useState<{
    curRankP1: number;
    curRankP2: number;
    scenarios: Record<string, { elo: number; rankW?: number; rankL?: number } | null>;
  } | null>(null);

  useEffect(() => {
    if (!seriesActive) return;
    const c1 = gameP1Char;
    const c2 = gameP2Char;
    if (!c1 || !c2 || !p1 || !p2) return;
    let cancelled = false;
    (async () => {
      const e1 = getElo(p1Stats, c1);
      const e2 = getElo(p2Stats, c2);
      const lb = await fetchLb();
      if (cancelled) return;
      const cur1 = lb.length ? rankAfter(lb, p1, c1, e1) : 999;
      const cur2 = lb.length ? rankAfter(lb, p2, c2, e2) : 999;

      const scenarios: Record<string, { elo: number; rankW?: number; rankL?: number } | null> = {};
      const defs = [
        { id: '30', p1wins: true, wk: 3, lk: 0 },
        { id: '31', p1wins: true, wk: 3, lk: 1 },
        { id: '32', p1wins: true, wk: 3, lk: 2 },
        { id: '03', p1wins: false, wk: 3, lk: 0 },
        { id: '13', p1wins: false, wk: 3, lk: 1 },
        { id: '23', p1wins: false, wk: 3, lk: 2 },
      ];
      for (const s of defs) {
        const wUser = s.p1wins ? p1 : p2;
        const wChar = s.p1wins ? c1 : c2;
        const lUser = s.p1wins ? p2 : p1;
        const lChar = s.p1wins ? c2 : c1;
        const we = s.p1wins ? e1 : e2;
        const le = s.p1wins ? e2 : e1;
        const wCurRank = s.p1wins ? cur1 : cur2;
        const lCurRank = s.p1wins ? cur2 : cur1;
        const { winner: wDelta, loser: lDelta } = duelEloDeltas(we, le, s.wk, s.lk, wCurRank, lCurRank);
        if (lb.length) {
          const wRank = rankAfter(lb, wUser, wChar, we + wDelta);
          const lRank = rankAfter(lb, lUser, lChar, Math.max(100, le - lDelta));
          scenarios[s.id] = { elo: wDelta, rankW: wRank, rankL: lRank };
        } else {
          scenarios[s.id] = { elo: wDelta }; // no leaderboard yet -- leave rank blank, matching the original
        }
      }
      if (!cancelled) setEloPreview({ curRankP1: cur1, curRankP2: cur2, scenarios });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesActive, gameP1Char, gameP2Char, p1, p2, p1Stats, p2Stats, lbCache === null]);

  async function playWinnerFlash(imgEl: HTMLImageElement | null) {
    if (!imgEl || imgEl.style.display === 'none') return;
    try {
      const { gsap } = await import('gsap');
      const rect = imgEl.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ring = document.createElement('div');
      ring.className = 'ring-flash';
      ring.style.left = rect.left + rect.width / 2 - size / 2 + 'px';
      ring.style.top = rect.top + rect.height / 2 - size / 2 + 'px';
      ring.style.width = size + 'px';
      ring.style.height = size + 'px';
      document.body.appendChild(ring);
      ring.addEventListener('animationend', () => ring.remove(), { once: true });
      gsap.fromTo(imgEl, { scale: 0.4, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' });
    } catch {
      // gsap unavailable -- same no-op as the original's `typeof gsap === 'undefined'` guard
    }
  }

  const p1ImgRef = useRef<HTMLImageElement>(null);
  const p2ImgRef = useRef<HTMLImageElement>(null);

  async function recordGame(winner: 1 | 2, winnerStocks: number, loserStocks: number) {
    try {
      navigator.vibrate?.([12, 30, 12]);
    } catch {
      // ignore
    }
    const c1 = gameP1Char;
    const c2 = gameP2Char;
    if (!c1 || !c2) {
      showToast('Select characters for this game', 'warn');
      return;
    }
    const winnerChar = winner === 1 ? c1 : c2;
    const loserChar = winner === 1 ? c2 : c1;
    const winnerElo = getElo(winner === 1 ? p1Stats : p2Stats, winnerChar);
    const loserElo = getElo(winner === 1 ? p2Stats : p1Stats, loserChar);
    if (loserElo - winnerElo >= 200) {
      const winnerName = winner === 1 ? p1 : p2;
      const loserName = winner === 1 ? p2 : p1;
      if (!confirm(`⚠️ Confirm Upset?\n${winnerName} (${winnerElo} elo) beat ${loserName} (${loserElo} elo).\n\nRecord this game?`)) return;
    }

    const winnerPlayer = winner === 1 ? p1 : p2;
    const loserPlayer = winner === 1 ? p2 : p1;

    try {
      const res = await apiPost<{ elo_delta?: number }>('/matches/record', {
        winner_username: winnerPlayer,
        winner_char: winnerChar,
        winner_kills: winnerStocks,
        loser_username: loserPlayer,
        loser_char: loserChar,
        loser_kills: loserStocks,
      });
      const eloDelta = res.elo_delta || 0;
      setLbCache(null);
      setGames((prev) => [...prev, { winner, winnerPlayer, loserPlayer, winnerChar, loserChar, wk: winnerStocks, lk: loserStocks, eloDelta }]);
      if (winner === 1) setP1Score((s) => s + 1);
      else setP2Score((s) => s + 1);
      setLiveEloDelta(eloDelta);
      playWinnerFlash(winner === 1 ? p1ImgRef.current : p2ImgRef.current);
      showToast(`Game recorded! Elo: ${winner === 1 ? p1 : p2} +${eloDelta}`, 'success');
    } catch (err) {
      showToast('Error recording game: ' + (err as Error).message, 'error');
    }
  }

  function resetSeries() {
    setSeriesActive(false);
  }

  const seriesC1 = gameP1Char || p1;
  const seriesC2 = gameP2Char || p2;

  return (
    <PageContainer style={{ maxWidth: 780 }}>
      <PageHeader>
        <h1>⚔️ 1v1 Duel</h1>
        <p>Play a series between two players. Every game updates Elo and all stats.</p>
      </PageHeader>

      {!seriesActive && (
        <div className="duel-card">
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Setup</div>
          <div className="duel-vs">
            <div className={`duel-side p1${underdogSide === 'p1' ? ' underdog' : ''}`}>
              <div className="player-label" style={{ color: 'var(--accent-blue)' }}>
                Player 1
              </div>
              <div className="avatar-picker-row">
                {allUsers.map((u) => {
                  const isSelected = selectedP1 === u.username;
                  const dimmed = selectedP2 === u.username && !!selectedP2;
                  return (
                    <div
                      key={u.username}
                      className={`av-pick${isSelected ? ' selected-p1' : ''}`}
                      style={dimmed ? { opacity: 0.3, pointerEvents: 'none' } : undefined}
                      onClick={() => setSelectedP1(u.username)}
                    >
                      <img
                        src={u.avatar_url || avFallback(u.username)}
                        alt={u.username}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = avFallback(u.username);
                        }}
                      />
                      <span>{u.username}</span>
                    </div>
                  );
                })}
              </div>
              <CharPicker value={p1CharSetup} onSelect={setP1CharSetup} />
              {selectedP1 && (
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4, fontSize: '0.78rem' }} onClick={() => quickStart('p1')}>
                  ⚡ Quick Start (top char)
                </button>
              )}
            </div>
            <div className="duel-divider">VS</div>
            <div className={`duel-side p2${underdogSide === 'p2' ? ' underdog' : ''}`}>
              <div className="player-label" style={{ color: 'var(--accent-gold)' }}>
                Player 2
              </div>
              <div className="avatar-picker-row">
                {allUsers.map((u) => {
                  const isSelected = selectedP2 === u.username;
                  const dimmed = selectedP1 === u.username && !!selectedP1;
                  return (
                    <div
                      key={u.username}
                      className={`av-pick${isSelected ? ' selected-p2' : ''}`}
                      style={dimmed ? { opacity: 0.3, pointerEvents: 'none' } : undefined}
                      onClick={() => setSelectedP2(u.username)}
                    >
                      <img
                        src={u.avatar_url || avFallback(u.username)}
                        alt={u.username}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = avFallback(u.username);
                        }}
                      />
                      <span>{u.username}</span>
                    </div>
                  );
                })}
              </div>
              <CharPicker value={p2CharSetup} onSelect={setP2CharSetup} />
              {selectedP2 && (
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4, fontSize: '0.78rem' }} onClick={() => quickStart('p2')}>
                  ⚡ Quick Start (top char)
                </button>
              )}
            </div>
          </div>
          <div className="sticky-bar">
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={startSeries}>
              Start Series
            </button>
          </div>
        </div>
      )}

      {!seriesActive && showPreview && (
        <div>
          <div className="duel-card">
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>Overall Record</div>
            {previewLoading ? (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>Loading…</span>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>
                    {selectedP1} &nbsp;{h2h?.user1_wins || 0}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {!h2h?.total ? 'No history yet' : h2h.leader ? `${h2h.leader} leads` : 'Even'}
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                    {h2h?.user2_wins || 0}&nbsp; {selectedP2}
                  </span>
                </div>
                <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(245,166,35,0.6)', marginBottom: 6 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${h2h?.total ? Math.round(((h2h.user1_wins || 0) / h2h.total) * 100) : 50}%`,
                      background: 'var(--accent-blue)',
                      borderRadius: 5,
                      transition: 'width 0.4s',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {h2h?.total || 0} match{(h2h?.total || 0) !== 1 ? 'es' : ''} total
                </div>
              </div>
            )}
          </div>

          {p1CharSetup && p2CharSetup && (
            <div className="duel-card">
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
                {p1CharSetup} vs {p2CharSetup}
              </div>
              {!matchup || matchup.user1_wins + matchup.user2_wins === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>No history for this matchup yet.</span>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>
                      {selectedP1} ({p1CharSetup}) &nbsp;{matchup.user1_wins}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {matchup.user1_wins + matchup.user2_wins} game{matchup.user1_wins + matchup.user2_wins !== 1 ? 's' : ''}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                      {matchup.user2_wins}&nbsp; {selectedP2} ({p2CharSetup})
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--accent-gold)' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((matchup.user1_wins / (matchup.user1_wins + matchup.user2_wins)) * 100)}%`,
                        background: 'var(--accent-blue)',
                        transition: 'width 0.4s',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <PlayerStatsCard label={`${selectedP1} — Characters`} color="var(--accent-blue)" stats={p1Stats} />
            <PlayerStatsCard label={`${selectedP2} — Characters`} color="var(--accent-gold)" stats={p2Stats} />
          </div>
        </div>
      )}

      {seriesActive && (
        <div>
          <div className="duel-card" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent-blue)' }}>
                {p1} <BadgePill badges={badges} username={p1} />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Series</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent-gold)' }}>
                {p2} <BadgePill badges={badges} username={p2} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
                {seriesC1 && <img ref={p1ImgRef} src={charImgUrl(seriesC1)} alt={seriesC1} style={{ width: 80, height: 80, objectFit: 'contain' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{seriesC1 || '—'}</span>
              </div>
              <div className="score-display" style={{ flex: 'none', margin: 0 }}>
                <span className="score-num p1">{p1Score}</span>
                <span className="score-dash">—</span>
                <span className="score-num p2">{p2Score}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
                {seriesC2 && <img ref={p2ImgRef} src={charImgUrl(seriesC2)} alt={seriesC2} style={{ width: 80, height: 80, objectFit: 'contain' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{seriesC2 || '—'}</span>
              </div>
            </div>
          </div>

          <div className="duel-card">
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Record Game</div>
            <div style={{ display: 'flex', gap: 20, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <RecordGameSide
                align="left"
                color="var(--accent-blue)"
                label={`${p1}'s Character`}
                scoreLabel={`${p1} Wins`}
                charValue={gameP1Char}
                onCharSelect={setGameP1Char}
                rankInfo={eloPreview ? { char: gameP1Char, rank: eloPreview.curRankP1, elo: getElo(p1Stats, gameP1Char) } : null}
                scenarioIds={['30', '31', '32']}
                eloPreview={eloPreview}
                onScore={(w, l) => recordGame(1, w, l)}
              />
              <RecordGameSide
                align="right"
                color="var(--accent-gold)"
                label={`${p2}'s Character`}
                scoreLabel={`${p2} Wins`}
                charValue={gameP2Char}
                onCharSelect={setGameP2Char}
                rankInfo={eloPreview ? { char: gameP2Char, rank: eloPreview.curRankP2, elo: getElo(p2Stats, gameP2Char) } : null}
                scenarioIds={['03', '13', '23']}
                eloPreview={eloPreview}
                onScore={(w, l) => recordGame(2, w, l)}
              />
            </div>
          </div>

          <div className="duel-card">
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>Game Log</div>
            <div className="game-log">
              {games.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>No games played yet.</div>
              ) : (
                [...games]
                  .reverse()
                  .map((g, ri) => {
                    const num = games.length - ri;
                    const scoreStr = g.wk > 0 ? ` (${g.wk}-${g.lk})` : '';
                    const isLatest = ri === 0;
                    return (
                      <div key={num} className={`game-row ${g.winner === 1 ? 'p1-won' : 'p2-won'}`}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>G{num}</span>
                        <span className="winner-tag">
                          {g.winnerPlayer} ({g.winnerChar}){scoreStr}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          beat {g.loserPlayer} ({g.loserChar})
                          {g.eloDelta ? (
                            <span className="num" style={{ color: '#4caf50', fontSize: '0.75rem' }}>
                              {' '}
                              +{isLatest && liveEloDelta !== null ? liveEloDelta : g.eloDelta} elo
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <button type="button" className="btn btn-outline" style={{ width: '100%', marginTop: 4 }} onClick={resetSeries}>
            New Series
          </button>
        </div>
      )}
    </PageContainer>
  );
}

function PlayerStatsCard({ label, color, stats }: { label: string; color: string; stats: CharStat[] }) {
  const rows = [...stats]
    .filter((s) => (s.wins || 0) + (s.losses || 0) > 0)
    .sort((a, b) => (b.elo || 1000) - (a.elo || 1000) || (b.kills || 0) - (a.kills || 0) || (b.points || 0) - (a.points || 0))
    .slice(0, 8);
  return (
    <div className="duel-card" style={{ flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color, marginBottom: 10 }}>{label}</div>
      {rows.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>No data yet.</span>
      ) : (
        rows.map((s) => {
          const total = (s.wins || 0) + (s.losses || 0);
          const pct = total > 0 ? Math.round(((s.wins || 0) / total) * 100) : 0;
          return (
            <div key={s.character} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
              <span style={{ fontWeight: 600 }}>{s.character}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>{s.elo || 1000}</span>
                <span style={{ color: winPctColor(pct), fontWeight: 600 }}>{pct}%</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {s.wins}W {s.losses}L
                </span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function RecordGameSide({
  align,
  color,
  label,
  scoreLabel,
  charValue,
  onCharSelect,
  rankInfo,
  scenarioIds,
  eloPreview,
  onScore,
}: {
  align: 'left' | 'right';
  color: string;
  label: string;
  scoreLabel: string;
  charValue: string;
  onCharSelect: (c: string) => void;
  rankInfo: { char: string; rank: number; elo: number } | null;
  scenarioIds: [string, string, string];
  eloPreview: { scenarios: Record<string, { elo: number; rankW?: number; rankL?: number } | null> } | null;
  onScore: (winnerStocks: number, loserStocks: number) => void;
}) {
  const scores: [number, number][] = [
    [3, 0],
    [3, 1],
    [3, 2],
  ];
  return (
    <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : undefined }}>
      <div className="player-label" style={{ color, marginBottom: 6, textAlign: align === 'right' ? 'right' : undefined }}>
        {label}
      </div>
      <div className="char-picker" style={{ width: '100%' }}>
        <CharPicker value={charValue} onSelect={onCharSelect} />
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '8px 0 10px', textAlign: align === 'right' ? 'right' : undefined }}>
        {rankInfo && (
          <>
            <span style={{ color: 'var(--text)' }}>{rankInfo.char}</span> <span style={{ color, fontWeight: 700 }}>#{rankInfo.rank}</span>{' '}
            <span style={{ color: 'var(--accent-gold)', fontSize: '0.68rem' }}>{rankInfo.elo} elo</span>
          </>
        )}
      </div>
      <div style={{ fontSize: '0.7rem', color, marginBottom: 8, fontWeight: 700, textAlign: align === 'right' ? 'right' : undefined }}>{scoreLabel}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(3,1fr)', gap: '4px 10px', alignItems: 'center' }}>
        <span />
        {scores.map(([w, l]) => (
          <div key={`${w}${l}`} style={{ textAlign: 'center', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            {w}-{l}
          </div>
        ))}
        <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Rank</span>
        {scenarioIds.map((id) => {
          const s = eloPreview?.scenarios[id];
          return (
            <div key={id} style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.55rem', color: '#4caf50', fontWeight: 700 }}>{s?.rankW != null ? `↑#${s.rankW}` : ''}</span>{' '}
              <span style={{ fontSize: '0.55rem', color: '#e74c3c', fontWeight: 700 }}>{s?.rankL != null ? `↓#${s.rankL}` : ''}</span>
            </div>
          );
        })}
        <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 600 }}>Elo</span>
        {scenarioIds.map((id) => {
          const s = eloPreview?.scenarios[id];
          return (
            <div key={id} style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.6rem', color: '#4caf50', fontWeight: 700 }}>{s ? `+${s.elo}` : ''}</span>
            </div>
          );
        })}
        <span />
        {scores.map(([w, l]) => (
          <button key={`${w}${l}`} type="button" className="score-btn" onClick={() => onScore(w, l)}>
            {w}-{l}
          </button>
        ))}
      </div>
    </div>
  );
}
