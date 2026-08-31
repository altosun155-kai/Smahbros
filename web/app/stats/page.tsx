// /stats — port of web/public/stats.html. Record bar, summary cards, per-
// character stats table, counter-pick advisor, and player-profile links.
// Reuses SMASH_ROSTER/charImgUrl (lib/chars.ts) and winPctColor
// (lib/colorUtils.ts) rather than re-deriving them.
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, apiPost, showToast } from '../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../lib/chars';
import { winPctColor } from '../lib/colorUtils';
import './stats.css';

interface CharStat {
  character: string;
  elo?: number;
  wins?: number;
  losses?: number;
  win_pct?: number | null;
  kills?: number;
  deaths?: number;
  kd?: number | null;
  games?: number;
  provisional?: boolean;
  points?: number;
}

interface EloLbRow {
  character: string;
  elo?: number;
  provisional?: boolean;
}

interface UserRow {
  username: string;
  avatar_url?: string | null;
}

function fallbackAvatar(username: string) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

function CpCharRow({ char, detail, star }: { char: string; detail: string; star: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <img
        style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }}
        src={charImgUrl(char)}
        alt={char}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <span style={{ fontSize: '0.88rem', fontWeight: 600, flex: 1 }}>{char}</span>
      {star && <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>★</span>}
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{detail}</span>
    </div>
  );
}

export default function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [myStats, setMyStats] = useState<CharStat[] | null>(null);
  const [globalCharBest, setGlobalCharBest] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<UserRow[]>([]);

  const [recordChar, setRecordChar] = useState('');
  const [cpOpponent, setCpOpponent] = useState('');

  async function loadStats() {
    setLoading(true);
    try {
      const data = await apiGet<CharStat[]>('/characters/stats');
      setMyStats(data || []);
    } catch (err) {
      showToast('Error loading stats: ' + (err as Error).message, 'error');
      setMyStats([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();

    apiGet<UserRow[]>('/users/all')
      .then((res) => setUsers(res || []))
      .catch(() => {});

    // Global per-character Elo for the counter-pick advisor -- leaderboard/elo
    // has real per-character Elo + provisional, unlike /characters/stats/leaderboard.
    apiGet<EloLbRow[]>('/characters/stats/leaderboard/elo')
      .then((lb) => {
        const best: Record<string, number> = {};
        (lb || []).forEach((row) => {
          if (row.provisional) return; // small-sample outliers don't count as "globally dominant"
          const rowElo = row.elo || 1000;
          if (rowElo > (best[row.character] || 0)) best[row.character] = rowElo;
        });
        setGlobalCharBest(best);
      })
      .catch(() => {});
  }, []);

  async function recordResult(result: 'win' | 'loss') {
    if (!recordChar) {
      showToast('Select a character first.', 'warn');
      return;
    }
    try {
      await apiPost('/characters/stats/record', { character: recordChar, result });
      showToast(`Recorded ${result} for ${recordChar}!`, 'success');
      loadStats();
    } catch (err) {
      showToast('Error recording: ' + (err as Error).message, 'error');
    }
  }

  const summary = useMemo(() => {
    const all = myStats || [];
    if (!all.length) return null;
    const byGames = [...all].sort((a, b) => (b.wins || 0) + (b.losses || 0) - ((a.wins || 0) + (a.losses || 0)));
    const mostPlayed = byGames[0];
    const byWinPct = all.filter((s) => (s.wins || 0) + (s.losses || 0) > 0).sort((a, b) => (b.win_pct || 0) - (a.win_pct || 0));
    const bestWin = byWinPct[0];
    const byKills = [...all].filter((s) => (s.kills || 0) > 0).sort((a, b) => (b.kills || 0) - (a.kills || 0));
    const mostKills = byKills[0];
    return { mostPlayed, bestWin, mostKills };
  }, [myStats]);

  const tableRows = useMemo(() => {
    const filtered = (myStats || []).filter((s) => (s.wins || 0) + (s.losses || 0) > 0);
    filtered.sort((a, b) => (b.elo || 1000) - (a.elo || 1000) || (b.kills || 0) - (a.kills || 0) || (b.points || 0) - (a.points || 0));
    return filtered;
  }, [myStats]);

  const cp = useMemo(() => {
    if (!cpOpponent) return null;
    const yourTop = [...(myStats || [])]
      .filter((s) => !s.provisional && s.character !== cpOpponent)
      .sort((a, b) => (b.elo || 1000) - (a.elo || 1000) || (b.kills || 0) - (a.kills || 0) || (b.points || 0) - (a.points || 0))
      .slice(0, 5);
    const globalTop = Object.entries(globalCharBest)
      .filter(([c]) => c !== cpOpponent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, best]) => ({ character: c, elo: best }));
    const globalChars = new Set(globalTop.map((g) => g.character));
    const yourChars = new Set(yourTop.map((y) => y.character));
    return { yourTop, globalTop, globalChars, yourChars };
  }, [cpOpponent, myStats, globalCharBest]);

  return (
    <PageContainer>
      <PageHeader>
        <h1>📊 Character Stats</h1>
        <p>Track your Elo rating per character. Win/loss results update Elo automatically.</p>
      </PageHeader>

      <div className="record-bar">
        <select value={recordChar} onChange={(e) => setRecordChar(e.target.value)}>
          <option value="">Select character…</option>
          {SMASH_ROSTER.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => recordResult('win')}>
          Win +1
        </button>
        <button type="button" className="btn btn-danger" onClick={() => recordResult('loss')}>
          Loss −1
        </button>
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <div className="card" style={{ padding: '14px 18px', flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 6 }}>
              Most Played
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {summary.mostPlayed?.character && <img src={charImgUrl(summary.mostPlayed.character)} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 3 }} />}
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{summary.mostPlayed?.character || '—'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {summary.mostPlayed
                    ? (() => {
                        const games = (summary.mostPlayed.wins || 0) + (summary.mostPlayed.losses || 0);
                        return games ? `${games} game${games !== 1 ? 's' : ''}` : '';
                      })()
                    : ''}
                </div>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: '14px 18px', flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 6 }}>
              Best Win %
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {summary.bestWin?.character && <img src={charImgUrl(summary.bestWin.character)} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 3 }} />}
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{summary.bestWin?.character || '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#27ae60', fontWeight: 700 }}>{summary.bestWin ? `${summary.bestWin.win_pct ?? 0}% win rate` : ''}</div>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: '14px 18px', flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 6 }}>
              Most Kills
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {summary.mostKills?.character && <img src={charImgUrl(summary.mostKills.character)} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 3 }} />}
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{summary.mostKills?.character || '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#e67e22', fontWeight: 700 }}>{summary.mostKills ? `${summary.mostKills.kills} kills` : ''}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading stats…</span>
        </div>
      )}

      {!loading && (
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Your Stats</h2>
          {tableRows.length === 0 && (
            <div className="empty-state">
              <p style={{ marginBottom: 10 }}>No stats yet.</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Use the record bar above or run a match in the <Link href="/bracket.html">Bracket Generator</Link> to start tracking Elo.
              </p>
            </div>
          )}
          {tableRows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Character</th>
                    <th>Elo</th>
                    <th>W / L</th>
                    <th>Win%</th>
                    <th>Kills</th>
                    <th>Deaths</th>
                    <th>K/D</th>
                    <th>Games</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((s, i) => {
                    const kills = s.kills || 0;
                    const deaths = s.deaths || 0;
                    const wins = s.wins || 0;
                    const losses = s.losses || 0;
                    const kdVal = s.kd;
                    return (
                      <tr key={s.character} className={s.provisional ? 'provisional-row' : undefined}>
                        <td className="rank-cell">{i + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <img
                              className="char-img"
                              src={charImgUrl(s.character)}
                              alt={s.character}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                            <span style={{ fontWeight: 500 }}>{s.character}</span>
                            {s.provisional && (
                              <span className="provisional-badge" title="Fewer than 8 games played — still a small sample">
                                Provisional
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="points-cell">{s.elo || 1000}</td>
                        <td>
                          {wins + losses > 0 ? (
                            <>
                              <span style={{ color: '#27ae60', fontWeight: 700 }}>{wins}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}> / </span>
                              <span style={{ color: '#e74c3c', fontWeight: 700 }}>{losses}</span>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {s.win_pct !== null && s.win_pct !== undefined ? (
                            <span style={{ fontWeight: 700, color: winPctColor(s.win_pct) }}>{s.win_pct}%</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {kills > 0 ? <span style={{ color: '#e67e22', fontWeight: 700 }}>{kills}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          {deaths > 0 ? <span style={{ color: '#e74c3c', fontWeight: 700 }}>{deaths}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          {kdVal !== null && kdVal !== undefined ? (
                            <span style={{ fontWeight: 700, color: kdVal >= 2 ? '#27ae60' : kdVal >= 1 ? 'var(--accent-gold)' : '#e74c3c' }}>{kdVal.toFixed(2)}</span>
                          ) : kills > 0 ? (
                            <span style={{ color: '#27ae60', fontWeight: 700 }}>∞</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{ color: 'var(--text-muted)' }}>{s.games ?? wins + losses}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <hr className="section-divider" style={{ marginTop: 28 }} />
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Counter-Pick Advisor</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 14 }}>
        Pick your opponent&apos;s character to see your strongest options and the globally dominant picks.
      </p>
      <div style={{ maxWidth: 320 }}>
        <select
          value={cpOpponent}
          onChange={(e) => setCpOpponent(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.9rem' }}
        >
          <option value="">Select opponent&apos;s character…</option>
          {SMASH_ROSTER.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {cp && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 600 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 12 }}>
                Your Strongest Picks
              </div>
              {cp.yourTop.length ? (
                cp.yourTop.map((s) => <CpCharRow key={s.character} char={s.character} detail={`${s.elo || 1000} Elo`} star={cp.globalChars.has(s.character)} />)
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No personal stats yet — play some matches first.</p>
              )}
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 12 }}>
                Globally Dominant
              </div>
              {cp.globalTop.length ? (
                cp.globalTop.map((s) => <CpCharRow key={s.character} char={s.character} detail={`${s.elo} Elo peak`} star={cp.yourChars.has(s.character)} />)
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No global data yet.</p>
              )}
            </div>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10 }}>
            Characters with <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>★</span> appear in both lists.
          </p>
        </div>
      )}

      <hr className="section-divider" style={{ marginTop: 28 }} />
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>View a player&apos;s profile</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {users.map((u) => (
          <Link
            key={u.username}
            href={`/profile.html?user=${encodeURIComponent(u.username)}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
              color: 'var(--text)',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 16px',
              minWidth: 80,
            }}
          >
            <img
              src={u.avatar_url || fallbackAvatar(u.username)}
              alt={u.username}
              style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = fallbackAvatar(u.username);
              }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{u.username}</span>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
