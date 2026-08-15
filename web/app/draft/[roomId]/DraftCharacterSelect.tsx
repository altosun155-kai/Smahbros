'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  // "Pinned" is favorites in rank order, or (if there are no favorites) the
  // player's tier list flattened S->F -- same fallback the rail has always
  // had. What's new: it's no longer the *whole* rail. Every remaining
  // roster character renders below it, alphabetically, so there's always
  // something pickable and nothing needs a full-screen "you haven't ranked
  // anything" block anymore.
  const [pinned, setPinned] = useState<string[]>([]);
  const [pinnedLabel, setPinnedLabel] = useState('Your Favorites');
  const [stats, setStats] = useState<StatRow[]>([]);
  const [query, setQuery] = useState('');
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
        setPinned(fav.characters);
        setPinnedLabel('Your Favorites');
        return;
      }

      // No power rankings -- fall back to the player's tier list, flattened S->F
      // (skipping "unranked" entries, since those are explicitly not ranked).
      const tierRes = await apiGet<{ ranking: Record<string, string[]> | null }>('/characters/ranking');
      const ranking = tierRes.ranking;
      const fromTierList = ranking ? TIER_ORDER.flatMap((t) => ranking[t] || []) : [];
      if (fromTierList.length > 0) {
        setPinned(fromTierList);
        setPinnedLabel('Your Tier List');
        return;
      }

      // Neither exists -- nothing pinned. The full roster below still gives
      // every player something to pick from; no blocking screen needed.
      setPinned([]);
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
      if (document.visibilityState === 'visible' && pinned.length === 0) loadRail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pinned.length, loadRail]);

  // Deduped, alphabetical remainder -- everything in the roster that isn't
  // already pinned above. Computed from `pinned`, not filtered by search yet,
  // so the search box only ever narrows what's already deduped.
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const rest = useMemo(
    () => SMASH_ROSTER.filter((c) => !pinnedSet.has(c)).sort((a, b) => a.localeCompare(b)),
    [pinnedSet]
  );

  const q = query.trim().toLowerCase();
  const pinnedFiltered = q ? pinned.filter((c) => c.toLowerCase().includes(q)) : pinned;
  const restFiltered = q ? rest.filter((c) => c.toLowerCase().includes(q)) : rest;

  const myPicks = room.picks[String(myId)] || [];
  const activePick = myPicks[activeSlot];
  const activeCharacter = activePick?.character ?? null;
  const activeStat = stats.find((s) => s.character === activeCharacter);

  // A character already assigned to one of this player's other slots can't be
  // picked again -- locked or not, it's used up.
  const pickedElsewhere = new Set(
    myPicks.filter((p, i) => i !== activeSlot && p.character).map((p) => p.character as string)
  );
  const allSlotsFilled = myPicks.length === room.chars_per_player && myPicks.every((p) => !!p.character);
  const allSlotsLocked = myPicks.length === room.chars_per_player && myPicks.every((p) => p.locked);

  async function pick(character: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/draft/rooms/${room.id}/pick`, { slot_index: activeSlot, character });
      onChanged();
      // Auto-advance to the next slot so picking N characters is one pass
      // through the rail instead of a manual tab-then-pick per slot.
      setActiveSlot((prev) => Math.min(prev + 1, room.chars_per_player - 1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Locks every slot at once -- only reachable once all slots have a pick, so
  // there's no partial/per-slot lock state to manage or unlock from the UI.
  async function lockAll() {
    setBusy(true);
    setError(null);
    try {
      for (const p of myPicks) {
        if (!p.locked) {
          await apiPost(`/draft/rooms/${room.id}/lock`, { slot_index: p.slot_index });
        }
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Shared by both rail sections so "already picked for another slot"
  // greys a character out identically wherever it appears -- pinned or
  // roster, there's only ever one row per character now (see `rest`'s dedup),
  // so this never has to reconcile two different rendered copies of the same
  // character.
  function railItem(c: string) {
    const taken = pickedElsewhere.has(c);
    return (
      <button
        key={c}
        type="button"
        className={`draft-rail-item${c === activeCharacter ? ' selected' : ''}${taken ? ' taken' : ''}`}
        disabled={busy || !!activePick?.locked || taken}
        title={taken ? `Already picked for another slot` : undefined}
        onClick={() => pick(c)}
      >
        <img src={charImgUrl(c)} alt={c} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        <span>{c}</span>
      </button>
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

      <input
        type="text"
        className="draft-rail-search"
        placeholder="Search characters…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="draft-select-panels">
        <div className="draft-rail">
          {pinnedFiltered.length > 0 && (
            <>
              <div className="draft-rail-divider">{pinnedLabel}</div>
              {pinnedFiltered.map(railItem)}
            </>
          )}
          {pinned.length === 0 && !q && (
            <div className="draft-rail-hint">
              No favorites yet —{' '}
              <a href="/tier-list.html" target="_blank" rel="noopener noreferrer">
                build a tier list
              </a>{' '}
              to get a pinned section here.
            </div>
          )}
          {restFiltered.length > 0 && (
            <>
              <div className="draft-rail-divider">All Fighters</div>
              {restFiltered.map(railItem)}
            </>
          )}
          {q && pinnedFiltered.length === 0 && restFiltered.length === 0 && (
            <div className="draft-rail-hint">No characters match &quot;{query}&quot;.</div>
          )}
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
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>
              {activeStat ? activeStat.elo : 'Unplayed'}
            </strong>
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
        <button type="button" className="btn btn-primary" disabled={!allSlotsFilled || allSlotsLocked || busy} onClick={lockAll}>
          {allSlotsLocked ? 'Locked in ✓' : 'Lock in'}
        </button>
        {!allSlotsFilled && room.chars_per_player > 1 && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {myPicks.filter((p) => p.character).length}/{room.chars_per_player} picked
          </span>
        )}
        {error && <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</span>}
      </div>
    </div>
  );
}
