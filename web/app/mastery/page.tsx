// /mastery — port of web/public/mastery.html. Grid of every roster
// character, colored by whichever connection "owns" it (highest points),
// with a claim-flip animation when a tile transitions from unowned to owned,
// a player showcase, a legend, and a client-side search filter.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, showToast } from '../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../lib/chars';
import './mastery.css';

const PLAYER_COLORS = ['#0077c8', '#f5a623', '#27ae60', '#e74c3c', '#9b59b6', '#1abc9c', '#e67e22', '#e91e8c', '#00bcd4', '#ff5722', '#8bc34a', '#ff9800'];

interface MasteryRow {
  character: string;
  username: string;
  avatar_url: string | null;
  points: number;
  wins: number;
  losses: number;
  is_me: boolean;
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

function MasteryTile({ char, data, color, justClaimed }: { char: string; data: MasteryRow | undefined; color: string | undefined; justClaimed: boolean }) {
  const [flipping, setFlipping] = useState(justClaimed);
  const [imgFailed, setImgFailed] = useState(false);
  const [triedAlt, setTriedAlt] = useState(false);

  // The tile for a given character is a stable component instance across
  // reloads (same `key`), so a claim that happens on a *later* loadMastery()
  // call (e.g. via the visibilitychange re-fetch) needs its own effect to
  // start the flip -- the useState initializer above only runs once, on the
  // first mount.
  useEffect(() => {
    if (justClaimed) setFlipping(true);
  }, [justClaimed]);

  const classes = ['mastery-tile', 'enter-view', data ? 'owned' : 'unowned', flipping ? 'flip-in' : ''].filter(Boolean).join(' ');
  const url = charImgUrl(char);
  const shortName = char.length > 7 ? char.slice(0, 6) + '…' : char;

  return (
    <div
      className={classes}
      style={data && color ? ({ borderColor: color, ['--owner-color' as string]: color } as React.CSSProperties) : undefined}
      onAnimationEnd={() => setFlipping(false)}
    >
      {url && !imgFailed ? (
        <img
          src={url}
          alt={char}
          onError={() => {
            // First failure: charImgUrl already returns the base portrait
            // (no separate "alt" URL scheme ported yet), so a failure here
            // means the base image itself is missing -- fall back to text.
            if (!triedAlt) {
              setTriedAlt(true);
              return;
            }
            setImgFailed(true);
          }}
        />
      ) : (
        <div className="char-fallback">{shortName}</div>
      )}

      {data && <div className={`owner-label${data.is_me ? ' owner-label-me' : ''}`}>{data.is_me ? '★ ' + data.username : data.username}</div>}

      <div className="tile-tooltip">
        <strong>{char}</strong>
        {data ? (
          <>
            <span style={{ color }}>{data.username}</span>
            <br />
            {data.points} pts · {data.wins}W {data.losses}L
          </>
        ) : (
          <span style={{ color: '#e74c3c', fontWeight: 700 }}>Skill Issue</span>
        )}
      </div>
    </div>
  );
}

export default function MasteryPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [rows, setRows] = useState<MasteryRow[]>([]);
  const [search, setSearch] = useState('');
  const prevMasteryMapRef = useRef<Record<string, MasteryRow>>({});
  const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set());
  const loadedOnceRef = useRef(false);

  async function loadMastery() {
    try {
      const data = await apiGet<MasteryRow[]>('/characters/mastery/connections');
      const nextMap: Record<string, MasteryRow> = {};
      data.forEach((d) => {
        nextMap[d.character] = d;
      });
      const prevMap = prevMasteryMapRef.current;
      const claimed = new Set<string>();
      Object.keys(nextMap).forEach((char) => {
        if (!prevMap[char]) claimed.add(char);
      });
      setJustClaimed(claimed);
      prevMasteryMapRef.current = nextMap;
      setRows(data);
      setLoading(false);
      loadedOnceRef.current = true;
    } catch (err) {
      setLoadError(true);
      showToast('Error loading mastery: ' + (err as Error).message, 'error');
    }
  }

  useEffect(() => {
    loadMastery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when the tab regains focus, so a character claimed elsewhere
  // gets a chance to play its claim-flip animation.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && loadedOnceRef.current) loadMastery();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const masteryMap = useMemo(() => {
    const m: Record<string, MasteryRow> = {};
    rows.forEach((d) => {
      m[d.character] = d;
    });
    return m;
  }, [rows]);

  const playerColorMap = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((d) => {
      counts[d.username] = (counts[d.username] || 0) + 1;
    });
    const players = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const map: Record<string, string> = {};
    players.forEach((p, i) => {
      map[p] = PLAYER_COLORS[i % PLAYER_COLORS.length];
    });
    return map;
  }, [rows]);

  const avatarMap = useMemo(() => {
    const m: Record<string, string> = {};
    rows.forEach((d) => {
      if (d.avatar_url) m[d.username] = d.avatar_url;
    });
    return m;
  }, [rows]);

  const players = Object.keys(playerColorMap);
  const byPlayer = useMemo(() => {
    const grouped: Record<string, { char: string; points: number; wins: number }[]> = {};
    rows.forEach((d) => {
      if (!grouped[d.username]) grouped[d.username] = [];
      grouped[d.username].push({ char: d.character, points: d.points, wins: d.wins });
    });
    return grouped;
  }, [rows]);

  const q = search.toLowerCase().trim();
  const visibleRoster = q ? SMASH_ROSTER.filter((c) => c.toLowerCase().includes(q)) : SMASH_ROSTER;

  const owned = Object.keys(masteryMap).length;
  const total = SMASH_ROSTER.length;
  const pct = total ? Math.round((owned / total) * 100) : 0;

  return (
    <PageContainer>
      <PageHeader>
        <h1>Character Mastery</h1>
        <p>Who in your circle dominates each character? Greyed = unclaimed. Colored = point leader.</p>
      </PageHeader>

      {loading && !loadError && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading mastery data…</span>
        </div>
      )}

      {loadError && <p style={{ color: 'var(--text-muted)' }}>Failed to load mastery data.</p>}

      {!loading && !loadError && (
        <div>
          <div className="mastery-stats">
            <div className="mastery-stat-pill">
              <strong>{owned}</strong> / {total} characters claimed
            </div>
            <div className="mastery-stat-pill">
              <strong>{total - owned}</strong> unclaimed
            </div>
            <div className="mastery-stat-pill">
              <strong>{pct}%</strong> roster coverage
            </div>
          </div>

          <div className="player-showcase">
            {players.map((username) => {
              const chars = (byPlayer[username] || []).sort((a, b) => b.points - a.points).slice(0, 5);
              const color = playerColorMap[username];
              const av = avatarMap[username] || fallbackAvatar(username);
              const totalChars = (byPlayer[username] || []).length;
              return (
                <div key={username} className="player-showcase-card" style={{ borderTopColor: color }}>
                  <div className="psc-header">
                    <img
                      className="psc-av"
                      src={av}
                      alt={username}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = fallbackAvatar(username);
                      }}
                    />
                    <span className="psc-name" style={{ color }}>
                      {username}
                    </span>
                    <span className="psc-count">
                      {totalChars} char{totalChars !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="psc-chars">
                    {chars.length > 0 ? (
                      chars.map((c) => (
                        <div key={c.char} className="psc-char" title={`${c.char} · ${c.points}pts`}>
                          <img
                            src={charImgUrl(c.char)}
                            alt={c.char}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No claims yet</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mastery-legend">
            <div style={{ width: '100%', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
              Players
            </div>
            {players.map((username) => (
              <div key={username} className="legend-item">
                <div className="legend-dot" style={{ background: playerColorMap[username] }} />
                <span style={{ color: 'var(--text)' }}>
                  {username} ({(byPlayer[username] || []).length})
                </span>
              </div>
            ))}
          </div>

          <div style={{ margin: '16px 0 8px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search characters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'var(--card-bg2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 8,
                padding: '7px 14px',
                fontSize: '0.85rem',
                width: 220,
                outline: 'none',
                transition: 'border-color .15s',
              }}
            />
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Clear
            </button>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {visibleRoster.length < total ? `${visibleRoster.length} of ${total} characters` : `${total} characters`}
            </span>
          </div>

          <div className="mastery-grid">
            {visibleRoster.map((char) => (
              <MasteryTile key={char} char={char} data={masteryMap[char]} color={masteryMap[char] ? playerColorMap[masteryMap[char].username] : undefined} justClaimed={justClaimed.has(char)} />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
