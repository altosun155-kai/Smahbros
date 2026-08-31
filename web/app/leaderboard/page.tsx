// /leaderboard — port of web/public/leaderboard.html. Four sections:
// per-character Elo leaderboard (filter/sort/paginate, desktop table +
// mobile cards), Global (player Elo, streaks, badges), User Avg Stats
// (weighted only -- see below), and a Rivalry Matrix, plus an Elo-history
// modal with a hand-rolled SVG sparkline.
//
// Not ported: setAvgMode('weighted'|'simple') toggle -- see CLAUDE.md's
// Known Gaps, no button ever existed to call it on the legacy page, so this
// always renders the weighted average, matching what's actually reachable.
'use client';

import { useEffect, useMemo, useState } from 'react';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, showToast } from '../lib/api';
import { charHeadUrl } from '../lib/chars';
import { winPctColor } from '../lib/colorUtils';
import { BadgePill, loadAllBadges, type BadgeInfo } from '../lib/badges';
import './leaderboard.css';

const PAGE_SIZE = 25;

interface CharLbRow {
  username: string;
  avatar_url: string | null;
  character: string;
  elo?: number;
  kills?: number;
  deaths?: number;
  kd?: number | null;
  wins: number;
  losses: number;
  win_pct?: number | null;
  provisional?: boolean;
}

interface GlobalRow {
  username: string;
  avatar_url: string | null;
  wins: number;
  losses: number;
  kills: number;
  win_rate: number | null;
  player_elo: number;
  streak: number;
}

interface AvgStats {
  avg_elo: number;
  avg_kills: number;
  avg_kd: number | null;
  avg_win_pct: number | null;
  avg_rank: number | null;
}

interface AvgRow {
  username: string;
  avatar_url: string | null;
  num_chars: number;
  total_games: number;
  weighted: AvgStats;
}

interface EloHistRow {
  won: boolean;
  elo_delta: number;
  opponent: string;
  opponent_char: string;
  my_kills: number;
  opp_kills: number;
  created_at: string;
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

function rankLabel(i: number, hash = false): string {
  return i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : hash ? `#${i + 1}` : `${i + 1}`;
}

function rowClass(i: number, isMine: boolean): string {
  return isMine ? 'char-row-mine' : i === 0 ? 'global-row-gold' : i === 1 ? 'global-row-silver' : i === 2 ? 'global-row-bronze' : '';
}

function ProvisionalBadge() {
  return (
    <span className="provisional-badge" title="Fewer than 8 games played — still a small sample">
      Provisional
    </span>
  );
}

// ── Sparkline (SVG), port of makeSparkline() ────────────────────────────────
function Sparkline({ deltas }: { deltas: number[] }) {
  const points = [0];
  let sum = 0;
  deltas.forEach((d) => {
    sum += d;
    points.push(sum);
  });
  const W = 320;
  const H = 52;
  const pad = 6;
  const minV = Math.min(...points);
  const maxV = Math.max(...points);
  const range = maxV - minV || 1;
  const n = points.length;
  const px = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const py = (v: number) => H - pad - ((v - minV) / range) * (H - pad * 2);
  const zero = Math.max(pad, Math.min(H - pad, py(0)));
  const pts = points.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const color = sum >= 0 ? '#27ae60' : '#e74c3c';
  const lastX = px(n - 1);
  const lastY = py(points[n - 1]);
  const sign = sum >= 0 ? '+' : '';
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', marginBottom: 12, borderRadius: 6, background: 'rgba(255,255,255,0.03)' }}>
      <line x1={pad} y1={zero.toFixed(1)} x2={W - pad} y2={zero.toFixed(1)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={3} fill={color} />
      <text x={W - pad - 2} y={Math.max(14, lastY - 6).toFixed(1)} textAnchor="end" fill={color} fontSize={11} fontWeight={700} style={{ fontFamily: 'monospace' }}>
        {sign}
        {sum}
      </text>
    </svg>
  );
}

export default function LeaderboardPage() {
  const [myUsername, setMyUsername] = useState('');
  const [badges, setBadges] = useState<Record<string, BadgeInfo>>({});

  // ── Character stats leaderboard ──
  const [charData, setCharData] = useState<CharLbRow[] | null>(null);
  const [filterPlayer, setFilterPlayer] = useState('');
  const [filterChar, setFilterChar] = useState('');
  const [hideProvisionalChar, setHideProvisionalChar] = useState(false);
  const [sortCol, setSortCol] = useState<keyof CharLbRow>('elo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [charPage, setCharPage] = useState(1);

  // ── Global leaderboard ──
  const [globalData, setGlobalData] = useState<GlobalRow[] | null>(null);
  const [hideProvisionalGlobal, setHideProvisionalGlobal] = useState(false);

  // ── User averages ──
  const [avgData, setAvgData] = useState<AvgRow[] | null>(null);

  // ── Rivalry matrix ──
  const [matrixPlayers, setMatrixPlayers] = useState<GlobalRow[] | null>(null);
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>> | null>(null);
  const [matrixFailed, setMatrixFailed] = useState(false);

  // ── Elo history modal ──
  const [histOpen, setHistOpen] = useState(false);
  const [histTitle, setHistTitle] = useState('');
  const [histLoading, setHistLoading] = useState(false);
  const [histRows, setHistRows] = useState<EloHistRow[] | null>(null);
  const [histError, setHistError] = useState<string | null>(null);

  useEffect(() => {
    setHideProvisionalChar(localStorage.getItem('lb_hideProvisionalChar') === '1');
    setHideProvisionalGlobal(localStorage.getItem('lb_hideProvisionalGlobal') === '1');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiGet<{ username: string }>('/users/me');
        setMyUsername(me?.username || '');
      } catch {
        // same silent catch as the original
      }
      loadAllBadges().then(setBadges);

      apiGet<CharLbRow[]>('/characters/stats/leaderboard/elo')
        .then((data) => setCharData(data || []))
        .catch((err) => showToast('Error loading leaderboard: ' + (err as Error).message, 'error'));

      apiGet<GlobalRow[]>('/leaderboard')
        .then((data) => setGlobalData(data || []))
        .catch((err) => showToast('Error loading global leaderboard: ' + (err as Error).message, 'error'));

      apiGet<AvgRow[]>('/characters/user-averages')
        .then((data) => setAvgData(data || []))
        .catch((err) => showToast('Error loading user averages: ' + (err as Error).message, 'error'));

      Promise.all([apiGet<GlobalRow[]>('/leaderboard'), apiGet<Record<string, Record<string, number>>>('/leaderboard/h2h-matrix')])
        .then(([lbData, m]) => {
          if (!lbData || lbData.length < 2) {
            setMatrixPlayers([]);
            return;
          }
          setMatrixPlayers(lbData.slice(0, 8));
          setMatrix(m);
        })
        .catch(() => setMatrixFailed(true));
    })();
  }, []);

  function toggleCharSort(col: keyof CharLbRow) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'losses' ? 'asc' : 'desc');
    }
    setCharPage(1);
  }

  // The full pipeline, in order -- rank has to be assigned after
  // filtering: computing it earlier leaves gaps once provisional/filtered
  // rows are excluded (ranks computed against the full set, then some just
  // vanish from view).
  const visibleCharRows = useMemo(() => {
    const all = charData || [];
    let rows = hideProvisionalChar ? all.filter((e) => !e.provisional) : all;
    const pf = filterPlayer.toLowerCase().trim();
    const cf = filterChar.toLowerCase().trim();
    if (pf) rows = rows.filter((e) => e.username.toLowerCase().includes(pf));
    if (cf) rows = rows.filter((e) => e.character.toLowerCase().includes(cf));

    const sorted = [...rows].sort((a, b) => {
      const av = (a[sortCol] as number | undefined) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bv = (b[sortCol] as number | undefined) ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return sorted.map((entry, i) => ({ ...entry, rank: i + 1 }));
  }, [charData, hideProvisionalChar, filterPlayer, filterChar, sortCol, sortDir]);

  const charTotalPages = Math.max(1, Math.ceil(visibleCharRows.length / PAGE_SIZE));
  const charPageClamped = Math.min(charPage, charTotalPages);
  const charPageRows = visibleCharRows.slice((charPageClamped - 1) * PAGE_SIZE, charPageClamped * PAGE_SIZE);

  const visibleGlobalRows = useMemo(() => {
    const all = globalData || [];
    return hideProvisionalGlobal ? all.filter((u) => u.win_rate != null) : all;
  }, [globalData, hideProvisionalGlobal]);

  async function openEloHist(username: string, character: string) {
    setHistTitle(`${character} — ${username}`);
    setHistOpen(true);
    setHistLoading(true);
    setHistRows(null);
    setHistError(null);
    try {
      const data = await apiGet<EloHistRow[]>(`/matches/history?username=${encodeURIComponent(username)}&character=${encodeURIComponent(character)}&limit=20`);
      setHistRows(data || []);
    } catch (err) {
      setHistError((err as Error).message);
    } finally {
      setHistLoading(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader>
        <h1>🏆 Leaderboard</h1>
        <p>Click any column header to sort. Win % requires 8+ games.</p>
      </PageHeader>

      {/* ── Character Stats ── */}
      <div className="section-label">Character Stats</div>
      {charData === null && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading leaderboard…</span>
        </div>
      )}
      {charData !== null && charData.length === 0 && (
        <div className="empty-state">
          <p>No character stats recorded yet.</p>
        </div>
      )}
      {charData !== null && charData.length > 0 && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter by player…"
              value={filterPlayer}
              onChange={(e) => {
                setFilterPlayer(e.target.value);
                setCharPage(1);
              }}
              style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', fontSize: '0.85rem', width: 180 }}
            />
            <input
              type="text"
              placeholder="Filter by character…"
              value={filterChar}
              onChange={(e) => {
                setFilterChar(e.target.value);
                setCharPage(1);
              }}
              style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', fontSize: '0.85rem', width: 200 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', width: 'fit-content' }}>
              <input
                type="checkbox"
                checked={hideProvisionalChar}
                onChange={(e) => {
                  setHideProvisionalChar(e.target.checked);
                  localStorage.setItem('lb_hideProvisionalChar', e.target.checked ? '1' : '0');
                  setCharPage(1);
                }}
              />
              Hide provisional ranks
            </label>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {hideProvisionalChar || filterPlayer.trim() || filterChar.trim() ? `${visibleCharRows.length} of ${charData.length} entries` : `${charData.length} entries`}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" id="charTable">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>Rank</th>
                  <th>Player</th>
                  <th>Character</th>
                  {(['elo', 'kills', 'deaths', 'kd', 'wins', 'losses', 'win_pct'] as const).map((col) => (
                    <th key={col} className={`sort-th${sortCol === col ? ` ${sortDir}` : ''}`} onClick={() => toggleCharSort(col)}>
                      {col === 'win_pct' ? 'Win %' : col === 'kd' ? 'K/D' : col[0].toUpperCase() + col.slice(1)}
                      <span className="sort-arrow" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {charPageRows.map((entry) => {
                  const i = entry.rank - 1;
                  const isMine = entry.username === myUsername;
                  const av = entry.avatar_url || fallbackAvatar(entry.username);
                  const headUrl = charHeadUrl(entry.character);
                  const pctColor = winPctColor(entry.win_pct ?? null);
                  const pctFill = entry.win_pct != null ? Math.min(100, entry.win_pct) : 0;
                  const kdVal = entry.kd;
                  return (
                    <tr
                      key={`${entry.username}-${entry.character}`}
                      className={`${rowClass(i, isMine)}${entry.provisional ? ' provisional-row' : ''} char-row-clickable`}
                      onClick={() => openEloHist(entry.username, entry.character)}
                    >
                      <td style={{ fontWeight: 800 }}>{rankLabel(i)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <img
                            className="user-av"
                            src={av}
                            alt={entry.username}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = fallbackAvatar(entry.username);
                            }}
                          />
                          <span style={{ fontWeight: 600 }}>{entry.username}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {headUrl && <img className="char-img-sm" src={headUrl} alt={entry.character} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                          <span>{entry.character}</span>
                          {entry.provisional && <ProvisionalBadge />}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent-gold)' }}>{entry.elo ?? 1000}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#e67e22' }}>{entry.kills ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#e74c3c' }}>{entry.deaths ?? '—'}</td>
                      <td>
                        {kdVal != null ? (
                          <span style={{ fontWeight: 700, color: kdVal >= 1.2 ? '#27ae60' : kdVal >= 1.0 ? '#ffe066' : '#e74c3c' }}>{kdVal.toFixed(2)}</span>
                        ) : (entry.kills ?? 0) > 0 ? (
                          <span style={{ color: '#27ae60', fontWeight: 700 }}>∞</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: '#27ae60' }}>{entry.wins}</td>
                      <td style={{ fontWeight: 700, color: '#e74c3c' }}>{entry.losses}</td>
                      <td>
                        <div style={{ fontWeight: 800, color: pctColor }}>{entry.win_pct != null ? `${entry.win_pct}%` : '—'}</div>
                        {entry.win_pct != null && (
                          <div className="winpct-bar">
                            <div className="winpct-fill" style={{ width: `${pctFill}%`, background: pctColor }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div id="charCardList">
            {charPageRows.map((entry) => {
              const i = entry.rank - 1;
              const isMine = entry.username === myUsername;
              const av = entry.avatar_url || fallbackAvatar(entry.username);
              const headUrl = charHeadUrl(entry.character);
              const pctColor = winPctColor(entry.win_pct ?? null);
              const kdVal = entry.kd;
              return (
                <MobileCard
                  key={`${entry.username}-${entry.character}-card`}
                  isMine={isMine}
                  provisional={!!entry.provisional}
                  rank={rankLabel(i, true)}
                  avatar={av}
                  onFallback={() => fallbackAvatar(entry.username)}
                  name={
                    <>
                      {entry.username}
                      {isMine ? ' ⚡' : ''} {headUrl && <img className="char-img-sm" src={headUrl} alt={entry.character} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{entry.character}</span>
                      {entry.provisional && <ProvisionalBadge />}
                    </>
                  }
                  headline={entry.elo ?? 1000}
                >
                  <div className="avg-detail-item">
                    <div className="avg-detail-label">Record</div>
                    <span style={{ color: '#27ae60', fontWeight: 700 }}>{entry.wins}W</span> <span style={{ color: '#e74c3c', fontWeight: 700 }}>{entry.losses}L</span>
                  </div>
                  <div className="avg-detail-item">
                    <div className="avg-detail-label">Win %</div>
                    <span style={{ fontWeight: 700, color: pctColor }}>{entry.win_pct != null ? `${entry.win_pct}%` : '—'}</span>
                  </div>
                  <div className="avg-detail-item">
                    <div className="avg-detail-label">K/D</div>
                    {kdVal != null ? kdVal.toFixed(2) : (entry.kills ?? 0) > 0 ? '∞' : '—'}
                  </div>
                  <div className="avg-detail-item">
                    <div className="avg-detail-label">Kills / Deaths</div>
                    {entry.kills ?? 0} / {entry.deaths ?? 0}
                  </div>
                </MobileCard>
              );
            })}
          </div>

          {charTotalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14, fontSize: '0.85rem' }}>
              <button
                type="button"
                disabled={charPageClamped <= 1}
                onClick={() => setCharPage((p) => Math.max(1, p - 1))}
                style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                ← Prev
              </button>
              <span style={{ color: 'var(--text-muted)' }}>
                Page {charPageClamped} of {charTotalPages}
              </span>
              <button
                type="button"
                disabled={charPageClamped >= charTotalPages}
                onClick={() => setCharPage((p) => Math.min(charTotalPages, p + 1))}
                style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Global + Avg split pane ── */}
      <div id="bottomSplit">
        <div id="globalSection">
          <div className="section-label">Global</div>
          {globalData === null && (
            <div className="loading-center">
              <div className="spinner" />
              <span>Loading global leaderboard…</span>
            </div>
          )}
          {globalData !== null && globalData.length === 0 && (
            <div className="empty-state">
              <p style={{ marginBottom: 12 }}>No match history yet — play a 1v1 Duel or Tournament to get on the board!</p>
              <a href="/duel" className="btn btn-primary btn-sm">
                ▶ Play a Duel
              </a>
            </div>
          )}
          {globalData !== null && globalData.length > 0 && (
            <div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', width: 'fit-content' }}>
                  <input
                    type="checkbox"
                    checked={hideProvisionalGlobal}
                    onChange={(e) => {
                      setHideProvisionalGlobal(e.target.checked);
                      localStorage.setItem('lb_hideProvisionalGlobal', e.target.checked ? '1' : '0');
                    }}
                  />
                  Hide provisional ranks
                </label>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" id="globalTable">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Player</th>
                      <th title="Player Elo — rated across all matches regardless of character">Elo</th>
                      <th>Wins</th>
                      <th>Losses</th>
                      <th title="Win rate (requires 8+ games to qualify for ranking)">Win %</th>
                      <th>Kills</th>
                      <th title="Hover to see all earned badges">Badges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGlobalRows.map((u, i) => {
                      const isProvisional = u.win_rate == null;
                      const isMine = u.username === myUsername;
                      const pctColor = winPctColor(u.win_rate);
                      return (
                        <tr key={u.username} className={`${rowClass(i, isMine)}${isProvisional ? ' provisional-row' : ''}`}>
                          <td style={{ fontWeight: 700 }}>{rankLabel(i)}</td>
                          <td style={{ fontWeight: 600 }}>
                            {u.username}
                            {u.streak >= 3 && (
                              <span className="streak-flame" title={`${u.streak}-game win streak`}>
                                🔥
                              </span>
                            )}
                            {isProvisional && <ProvisionalBadge />}
                          </td>
                          <td style={{ fontWeight: 800, color: 'var(--accent-gold)' }}>{u.player_elo ?? 1000}</td>
                          <td style={{ color: '#27ae60', fontWeight: 700 }}>{u.wins || 0}</td>
                          <td style={{ color: '#e74c3c', fontWeight: 700 }}>{u.losses || 0}</td>
                          <td style={{ fontWeight: 800, color: pctColor }}>{u.win_rate != null ? `${u.win_rate}%` : '—'}</td>
                          <td style={{ color: '#e67e22', fontWeight: 700 }}>{u.kills || 0}</td>
                          <td>
                            <BadgePill badges={badges} username={u.username} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div id="globalCardList">
                {visibleGlobalRows.map((u, i) => {
                  const isProvisional = u.win_rate == null;
                  const isMine = u.username === myUsername;
                  const pctColor = winPctColor(u.win_rate);
                  return (
                    <MobileCard
                      key={u.username}
                      isMine={isMine}
                      provisional={isProvisional}
                      rank={rankLabel(i, true)}
                      avatar={u.avatar_url || fallbackAvatar(u.username)}
                      onFallback={() => fallbackAvatar(u.username)}
                      name={
                        <>
                          {u.username}
                          {u.streak >= 3 && (
                            <span className="streak-flame" title={`${u.streak}-game win streak`}>
                              🔥
                            </span>
                          )}
                          {isMine ? ' ⚡' : ''}
                          {isProvisional && <ProvisionalBadge />}
                        </>
                      }
                      headline={u.player_elo ?? 1000}
                    >
                      <div className="avg-detail-item">
                        <div className="avg-detail-label">Record</div>
                        <span style={{ color: '#27ae60', fontWeight: 700 }}>{u.wins || 0}W</span> <span style={{ color: '#e74c3c', fontWeight: 700 }}>{u.losses || 0}L</span>
                      </div>
                      <div className="avg-detail-item">
                        <div className="avg-detail-label">Win %</div>
                        <span style={{ fontWeight: 700, color: pctColor }}>{u.win_rate != null ? `${u.win_rate}%` : '—'}</span>
                      </div>
                      <div className="avg-detail-item">
                        <div className="avg-detail-label">Kills</div>
                        {u.kills || 0}
                      </div>
                      <div className="avg-detail-item">
                        <div className="avg-detail-label">Badges</div>
                        <BadgePill badges={badges} username={u.username} /> {!badges[u.username] && '—'}
                      </div>
                    </MobileCard>
                  );
                })}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10 }}>
                <strong>Provisional</strong> ranks belong to players with fewer than 8 recorded games — their win rate isn&apos;t reliable yet, so they&apos;re listed below everyone else until they qualify.
              </p>
            </div>
          )}
        </div>

        <div id="avgSection">
          <div className="section-label" style={{ marginTop: 0 }}>
            User Avg Stats
          </div>
          {avgData === null && (
            <div className="loading-center">
              <div className="spinner" />
              <span>Loading…</span>
            </div>
          )}
          {avgData !== null && avgData.length === 0 && (
            <div className="empty-state">
              <p>No stats available yet.</p>
            </div>
          )}
          {avgData !== null && avgData.length > 0 && (
            <AvgTable data={avgData} myUsername={myUsername} />
          )}
        </div>
      </div>

      {/* ── Rivalry Matrix ── */}
      <div style={{ marginTop: 44 }} id="matrixSection">
        <div className="section-label">Rivalry Matrix</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>Head-to-head win–loss for every pair. Your row is highlighted.</p>
        {matrixPlayers === null && !matrixFailed && (
          <div className="loading-center">
            <div className="spinner" />
            <span>Loading…</span>
          </div>
        )}
        {(matrixFailed || (matrixPlayers !== null && matrixPlayers.length === 0)) && (
          <div className="empty-state">
            <p>Not enough players with match history yet.</p>
          </div>
        )}
        {matrixPlayers !== null && matrixPlayers.length > 0 && matrix && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" id="matrixTable" style={{ minWidth: 320 }}>
              <thead>
                <tr>
                  <th />
                  {matrixPlayers.map((p) => (
                    <th key={p.username}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <img
                          className="user-av"
                          src={p.avatar_url || fallbackAvatar(p.username)}
                          alt={p.username}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = fallbackAvatar(p.username);
                          }}
                        />
                        <span style={{ fontSize: '0.72rem' }}>{p.username}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixPlayers.map((rowP) => {
                  const isMe = rowP.username === myUsername;
                  return (
                    <tr key={rowP.username} className={isMe ? 'matrix-me' : undefined}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <img
                            className="user-av"
                            src={rowP.avatar_url || fallbackAvatar(rowP.username)}
                            alt=""
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = fallbackAvatar(rowP.username);
                            }}
                          />
                          <strong>{rowP.username}</strong>
                        </div>
                      </td>
                      {matrixPlayers.map((colP) => {
                        if (rowP.username === colP.username) {
                          return (
                            <td key={colP.username} className="matrix-self">
                              —
                            </td>
                          );
                        }
                        const wins = matrix[rowP.username]?.[colP.username] || 0;
                        const losses = matrix[colP.username]?.[rowP.username] || 0;
                        if (wins + losses === 0) {
                          return (
                            <td key={colP.username} style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              0–0
                            </td>
                          );
                        }
                        const cls = wins > losses ? 'matrix-win' : wins < losses ? 'matrix-loss' : 'matrix-even';
                        return (
                          <td key={colP.username} className={cls} title={`${wins}W ${losses}L vs ${colP.username}`}>
                            {wins}–{losses}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Elo history modal ── */}
      {histOpen && (
        <div
          id="eloHistModal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHistOpen(false);
          }}
        >
          <div className="elohist-box">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>{histTitle}</h3>
              <button type="button" onClick={() => setHistOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer', padding: '2px 6px' }}>
                ✕
              </button>
            </div>
            <div>
              {histLoading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>}
              {histError && <div style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Error: {histError}</div>}
              {histRows && histRows.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '8px 0' }}>No matches recorded yet.</div>}
              {histRows && histRows.length > 0 && (
                <>
                  {histRows.length >= 2 && <Sparkline deltas={[...histRows].reverse().map((r) => r.elo_delta)} />}
                  {histRows.map((r, i) => {
                    const sign = r.elo_delta >= 0 ? '+' : '';
                    const color = r.elo_delta >= 0 ? '#27ae60' : '#e74c3c';
                    const score = r.my_kills || r.opp_kills ? `${r.my_kills}-${r.opp_kills}` : '';
                    const date = new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={i} className="elohist-row">
                        <span className="elohist-delta" style={{ color }}>
                          {sign}
                          {r.elo_delta}
                        </span>
                        {r.won ? <span style={{ color: '#27ae60', fontWeight: 700 }}>W</span> : <span style={{ color: '#e74c3c', fontWeight: 700 }}>L</span>}
                        <span className="elohist-vs">
                          vs <strong>{r.opponent}</strong> <span style={{ color: 'var(--text-muted)' }}>({r.opponent_char})</span>
                        </span>
                        {score && <span className="elohist-score">{score}</span>}
                        <span className="elohist-date">{date}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function AvgTable({ data, myUsername }: { data: AvgRow[]; myUsername: string }) {
  const sorted = [...data].sort((a, b) => (b.weighted.avg_elo ?? 0) - (a.weighted.avg_elo ?? 0));
  function kdColor(v: number | null) {
    if (v == null) return 'var(--text-muted)';
    return v >= 1.2 ? '#27ae60' : v >= 1.0 ? '#ffe066' : '#e74c3c';
  }
  return (
    <div>
      <div style={{ overflowX: 'auto' }} id="avgTableWrap">
        <table className="data-table" id="avgTable">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Rank</th>
              <th>Player</th>
              <th title="Number of distinct characters played">Chars</th>
              <th title="Total matches recorded across all characters">Games</th>
              <th title="Your overall player Elo — the same rating shown on the Global leaderboard, not an average across characters.">Avg Elo ⓘ</th>
              <th title="Weighted K/D: Σ(kd × elo) ÷ Σ(elo). Higher-Elo characters count more toward your K/D.">Avg K/D ⓘ</th>
              <th title="True win rate: total wins ÷ total games across all characters.">Avg Win% ⓘ</th>
              <th title="Average leaderboard rank across your characters (lower = better). Only counts characters with 8+ games.">Avg Rank ⓘ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u, i) => {
              const s = u.weighted;
              const isMine = u.username === myUsername;
              const av = u.avatar_url || fallbackAvatar(u.username);
              return (
                <tr key={u.username} className={rowClass(i, isMine)}>
                  <td style={{ fontWeight: 800 }}>{rankLabel(i)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <img
                        className="user-av"
                        src={av}
                        alt={u.username}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = fallbackAvatar(u.username);
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>
                        {u.username}
                        {isMine && (
                          <span title="You" style={{ fontSize: '0.85rem' }}>
                            {' '}
                            ⚡
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{u.num_chars}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{u.total_games}</td>
                  <td style={{ fontWeight: 800, color: 'var(--accent-gold)' }}>{s.avg_elo ?? '—'}</td>
                  <td style={{ fontWeight: 700, color: kdColor(s.avg_kd) }}>{s.avg_kd != null ? s.avg_kd.toFixed(2) : '—'}</td>
                  <td>
                    {s.avg_win_pct != null ? (
                      <div>
                        <span style={{ fontWeight: 800, color: winPctColor(s.avg_win_pct) }}>{s.avg_win_pct}%</span>
                        <div className="winpct-bar">
                          <div className="winpct-fill" style={{ width: `${Math.min(100, Math.max(0, s.avg_win_pct))}%`, background: winPctColor(s.avg_win_pct) }} />
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.avg_rank != null ? `#${s.avg_rank}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div id="avgCardList">
        {sorted.map((u, i) => {
          const s = u.weighted;
          const isMine = u.username === myUsername;
          const av = u.avatar_url || fallbackAvatar(u.username);
          const pctColor = winPctColor(s.avg_win_pct);
          return (
            <MobileCard
              key={u.username}
              isMine={isMine}
              provisional={false}
              rank={rankLabel(i, true)}
              avatar={av}
              onFallback={() => fallbackAvatar(u.username)}
              name={
                <>
                  {u.username}
                  {isMine ? ' ⚡' : ''}
                </>
              }
              headline={s.avg_elo ?? '—'}
            >
              <div className="avg-detail-item">
                <div className="avg-detail-label">Avg K/D</div>
                <span style={{ fontWeight: 700, color: kdColor(s.avg_kd) }}>{s.avg_kd != null ? s.avg_kd.toFixed(2) : '—'}</span>
              </div>
              <div className="avg-detail-item">
                <div className="avg-detail-label">Avg Win %</div>
                <span style={{ fontWeight: 700, color: pctColor }}>{s.avg_win_pct != null ? `${s.avg_win_pct}%` : '—'}</span>
                {s.avg_win_pct != null && (
                  <div className="winpct-bar" style={{ marginTop: 3 }}>
                    <div className="winpct-fill" style={{ width: `${Math.min(100, s.avg_win_pct)}%`, background: pctColor }} />
                  </div>
                )}
              </div>
              <div className="avg-detail-item">
                <div className="avg-detail-label">Characters</div>
                {u.num_chars}
              </div>
              <div className="avg-detail-item">
                <div className="avg-detail-label">Games</div>
                {u.total_games}
              </div>
              <div className="avg-detail-item">
                <div className="avg-detail-label">Avg LB Rank</div>
                {s.avg_rank != null ? `#${s.avg_rank}` : '—'}
              </div>
            </MobileCard>
          );
        })}
      </div>
    </div>
  );
}

// Shared mobile expand/collapse card -- port of the repeated
// avg-card/avg-card-header/avg-card-detail markup used by all three
// mobile card lists (char/global/avg).
function MobileCard({
  isMine,
  provisional,
  rank,
  avatar,
  onFallback,
  name,
  headline,
  children,
}: {
  isMine: boolean;
  provisional: boolean;
  rank: string;
  avatar: string;
  onFallback: () => string;
  name: React.ReactNode;
  headline: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`avg-card${isMine ? ' me-card' : ''}${provisional ? ' provisional-row' : ''}${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)}>
      <div className="avg-card-header">
        <span className="avg-card-rank">{rank}</span>
        <img
          className="user-av"
          src={avatar}
          alt=""
          style={{ width: 28, height: 28, borderRadius: '50%' }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = onFallback();
          }}
        />
        <span className="avg-card-name">{name}</span>
        <span className="avg-card-elo">{headline}</span>
        <span className="avg-card-chevron">›</span>
      </div>
      <div className="avg-card-detail">{children}</div>
    </div>
  );
}
