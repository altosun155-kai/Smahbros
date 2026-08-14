'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../../lib/chars';
import type { DraftRoomState } from '../../lib/useDraftRoom';

interface StatRow {
  character: string;
  elo: number;
  wins: number;
  losses: number;
  win_pct: number | null;
  provisional: boolean;
}

const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'F'] as const;

export default function DraftCharacterSelect({
  room,
  myId,
  onChanged,
}: {
  room: DraftRoomState;
  myId: number;
  onChanged: () => void;
}) {
  const [rail, setRail] = useState<string[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [noRankings, setNoRankings] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRail = useCallback(async () => {
    try {
      const [fav, statRows] = await Promise.all([
        apiGet<{ characters: string[] }>('/characters/favorites'),
        apiGet<StatRow[]>('/characters/stats'),
      ]);
      setStats(statRows);

      if (fav.characters && fav.characters.length > 0) {
        setRail(fav.characters);
        setNoRankings(false);
        return;
      }

      // No power rankings -- fall back to the player's tier list, flattened S->F
      // (skipping "unranked" entries, since those are explicitly not ranked).
      const tierRes = await apiGet<{ ranking: Record<string, string[]> | null }>('/characters/ranking');
      const ranking = tierRes.ranking;
      const fromTierList = ranking ? TIER_ORDER.flatMap((t) => ranking[t] || []) : [];
      if (fromTierList.length > 0) {
        setRail(fromTierList);
        setNoRankings(false);
        return;
      }

      // Neither exists -- don't silently dump the full roster. Ask.
      setNoRankings(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadRail();
  }, [loadRail]);

  // "Build a tier list" opens tier-list.html in a new tab -- re-check when the
  // player comes back, so finishing it there is reflected here without a manual reload.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && noRankings) loadRail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [noRankings, loadRail]);

  function pickManually() {
    setRail(SMASH_ROSTER);
    setNoRankings(false);
  }

  const myPicks = room.picks[String(myId)] || [];
  const activePick = myPicks[activeSlot];
  const activeCharacter = activePick?.character ?? null;
  const activeStat = stats.find((s) => s.character === activeCharacter);

  async function pick(character: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/draft/rooms/${room.id}/pick`, { slot_index: activeSlot, character });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    setBusy(true);
    setError(null);
    try {
      if (activePick?.locked) {
        await apiPost(`/draft/rooms/${room.id}/unlock`, { slot_index: activeSlot });
      } else {
        await apiPost(`/draft/rooms/${room.id}/lock`, { slot_index: activeSlot });
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (noRankings) {
    return (
      <div className="draft-select" style={{ alignItems: 'center', textAlign: 'center', gap: 16, padding: '48px 24px' }}>
        <p style={{ maxWidth: 380 }}>
          You haven&apos;t ranked any characters yet — favorites and tier list are both empty. Rank a few first, or just pick
          from the full roster.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <a className="btn btn-primary" href="/tier-list.html" target="_blank" rel="noopener noreferrer">
            Build a tier list
          </a>
          <button type="button" className="btn btn-outline" onClick={pickManually}>
            Pick manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-select">
      {room.chars_per_player > 1 && (
        <div className="draft-slot-tabs">
          {myPicks.map((p, i) => (
            <button
              key={i}
              type="button"
              className={i === activeSlot ? 'btn btn-primary' : 'btn btn-outline'}
              onClick={() => setActiveSlot(i)}
            >
              {p.locked ? '🔒 ' : ''}
              Slot {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="draft-select-panels">
        <div className="draft-rail">
          {rail.map((c) => (
            <button
              key={c}
              type="button"
              className={`draft-rail-item${c === activeCharacter ? ' selected' : ''}`}
              disabled={busy || !!activePick?.locked}
              onClick={() => pick(c)}
            >
              <img src={charImgUrl(c)} alt={c} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
              <span>{c}</span>
            </button>
          ))}
        </div>

        <div className="draft-portrait">
          {activeCharacter ? (
            <img src={charImgUrl(activeCharacter)} alt={activeCharacter} />
          ) : (
            <div className="draft-portrait-empty">Pick a character</div>
          )}
        </div>

        <div className="draft-stats-grid">
          <div className="draft-stat">
            <span>Elo</span>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>{activeStat?.elo ?? 1000}</strong>
          </div>
          <div className="draft-stat">
            <span>Record</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>
              {activeStat ? `${activeStat.wins}-${activeStat.losses}` : '—'}
            </strong>
          </div>
          <div className="draft-stat">
            <span>Win%</span>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{activeStat?.win_pct != null ? `${activeStat.win_pct}%` : '—'}</strong>
          </div>
          <div className="draft-stat">
            <span>Status</span>
            <strong>{activeStat?.provisional ? 'Provisional' : activeStat ? 'Ranked' : '—'}</strong>
          </div>
        </div>
      </div>

      <div className="sticky-bar">
        <button type="button" className="btn btn-primary" disabled={!activeCharacter || busy} onClick={toggleLock}>
          {activePick?.locked ? 'Unlock' : 'Lock in'}
        </button>
        {error && <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</span>}
      </div>
    </div>
  );
}
