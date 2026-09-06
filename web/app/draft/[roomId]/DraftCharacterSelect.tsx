'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { charHeadUrl, charImgUrl, SMASH_ROSTER } from '../../lib/chars';
import { haptic } from '../../lib/haptics';
import type { DraftPick, DraftRoomState } from '../../lib/useDraftRoom';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface StatRow {
  character: string;
  elo: number;
  wins: number;
  losses: number;
  win_pct: number | null;
  provisional: boolean;
}

const MOBILE_GRID_SIZE = 10;

// Matches style.css's `@media (max-width: 700px)` breakpoint for this
// screen -- kept as one number so the JS branch and the CSS never drift
// apart. Reactive (via matchMedia's change event, not a one-shot check like
// tier-list/page.tsx's isTouchDevice()) because this drives which of two
// entirely different JSX trees renders, not just an event-handler branch --
// a rotation or a resized window needs to actually re-render.
function useIsMobile(breakpoint = 700): boolean {
  // Starts false unconditionally (not a window.innerWidth check) so the
  // client's very first render matches the server-rendered HTML -- this
  // component is 'use client' but still gets an initial SSR pass (same
  // reason web/app/lib/useDocumentTitle.ts exists, see CLAUDE.md), and
  // window doesn't exist there. Reading matchMedia into the initializer
  // instead would make the client's first render disagree with the
  // server's whenever it actually runs on a narrow viewport -- React
  // detects the two don't match and reconciles with a console warning, on
  // exactly the devices this hook exists for. Set for real in the effect
  // below, after mount -- a one-frame flash of the desktop tree on a phone
  // is the accepted tradeoff for not fighting hydration on every load.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);
  return isMobile;
}

function highestFilledIndex(slots: DraftPick[]): number | null {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].character) return i;
  }
  return null;
}

export default function DraftCharacterSelect({
  room,
  myId,
  onChanged,
  setPick,
}: {
  room: DraftRoomState;
  myId: number;
  onChanged: () => void;
  // Owned by useDraftRoom -- applies a slot change optimistically (instant,
  // no round-trip wait) and rolls back on failure. Mobile routes every
  // add/remove through this; desktop keeps its own existing raw apiPut +
  // refetch path below, untouched (see the "Desktop unchanged" note on
  // desktopPick).
  setPick: (slotIndex: number, character: string | null) => Promise<void>;
}) {
  // "Pinned" is favorites, in the player's own saved order (set at
  // /favorites, capped at 10 there already) -- nothing else feeds it.
  // Everything NOT pinned renders below it (desktop rail) / behind "More
  // fighters" (mobile), ordered by how many times this player has actually
  // won with that character, most-won first -- not alphabetically. A
  // character with no CharacterStats row at all (never played) has no wins
  // recorded, so it sorts into the same "0 wins" bucket as a played-but-
  // winless character; both fall back to alphabetical order for a stable,
  // predictable list rather than reflecting arbitrary roster-array order.
  const [pinned, setPinned] = useState<string[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [query, setQuery] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // ── Desktop-only cursor state -- untouched by the mobile reframe below.
  // Desktop keeps the "active slot" model exactly as it worked before; only
  // mobile drops the cursor concept (see the module comment history in
  // CLAUDE.md/this file's git log for why the cursor was the bug on mobile).
  const [activeSlot, setActiveSlot] = useState(0);
  const [busy, setBusy] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const loadRail = useCallback(async () => {
    try {
      const [fav, statRows] = await Promise.all([
        apiGet<{ characters: string[] }>('/characters/favorites'),
        apiGet<StatRow[]>('/characters/stats'),
      ]);
      setStats(statRows);
      setPinned(fav.characters || []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadRail();
  }, [loadRail]);

  // "Set favorites" opens /favorites in a new tab -- re-check when the
  // player comes back, so finishing it there is reflected here without a manual reload.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pinned.length === 0) loadRail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pinned.length, loadRail]);

  // Per-character win count for this player, from the same /characters/stats
  // fetch already needed for the stat line -- no second request just to sort
  // the "rest" list. A character absent from `stats` (no CharacterStats row
  // -- never played) reads as 0 wins via the `?? 0`, landing in the same
  // untested/winless tier as everything else with 0 wins.
  const winsByChar = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stats) m.set(s.character, s.wins);
    return m;
  }, [stats]);

  // Full stat row per character, for the "More fighters" modal's per-tile
  // Elo/record -- same /characters/stats fetch as winsByChar above, so this
  // is a second lookup map over data already in hand, not a second request.
  // A character with no row here (never played) reads as unplayed -- most
  // of the roster, for any one player.
  const statsByChar = useMemo(() => {
    const m = new Map<string, StatRow>();
    for (const s of stats) m.set(s.character, s);
    return m;
  }, [stats]);

  // Deduped remainder -- everything in the roster that isn't already pinned
  // above -- ordered by wins descending, alphabetical as the tiebreak (covers
  // both real ties and the shared "0 wins" bucket of untested/winless
  // characters, which would otherwise sort in arbitrary roster-array order).
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const rest = useMemo(
    () =>
      SMASH_ROSTER.filter((c) => !pinnedSet.has(c)).sort((a, b) => {
        const winsA = winsByChar.get(a) ?? 0;
        const winsB = winsByChar.get(b) ?? 0;
        return winsB !== winsA ? winsB - winsA : a.localeCompare(b);
      }),
    [pinnedSet, winsByChar]
  );

  // Mobile's 2x5 grid: favorites if there are any (in saved order, however
  // many there are -- not topped up to 10, so a partial favorites list reads
  // as exactly that rather than blurring into unrelated fill characters).
  // With zero favorites there's nothing to show there, so it falls back to
  // the same wins-ordered list "rest" already computes -- this player's 10
  // most-won characters -- rather than an empty grid on first load.
  const mobileGridChars = useMemo(
    () => (pinned.length > 0 ? pinned.slice(0, MOBILE_GRID_SIZE) : rest.slice(0, MOBILE_GRID_SIZE)),
    [pinned, rest]
  );
  const mobileGridLabel = pinned.length > 0 ? 'Your Favorites' : 'Most Played';

  const q = query.trim().toLowerCase();
  const pinnedFiltered = q ? pinned.filter((c) => c.toLowerCase().includes(q)) : pinned;
  const restFiltered = q ? rest.filter((c) => c.toLowerCase().includes(q)) : rest;

  // `room.picks[myKey]` is already the right array regardless of branch --
  // useDraftRoom splices in the locally-owned, optimistically-updated
  // myPicks here while status === 'picking' (see that hook), so this
  // component doesn't need to know or care that the WS broadcast is masked.
  const myPicks = room.picks[String(myId)] || [];
  const allFilled = myPicks.length === room.chars_per_player && myPicks.every((p) => !!p.character);
  const allLocked = myPicks.length === room.chars_per_player && myPicks.every((p) => p.locked);

  // ── Desktop-only derived state (cursor-relative) ──────────────────────
  const activePick = myPicks[activeSlot];
  const activeCharacter = activePick?.character ?? null;
  const activeStat = stats.find((s) => s.character === activeCharacter);
  // A character already assigned to one of this player's OTHER slots can't
  // be picked again from the desktop rail -- locked or not, it's used up.
  // Desktop has no remove-by-tap gesture (unchanged from before this
  // round), so "taken" there still just means "disabled", not "tap to undo".
  const pickedElsewhere = new Set(
    myPicks.filter((p, i) => i !== activeSlot && p.character).map((p) => p.character as string)
  );

  // Desktop's own pick -- byte-for-byte the same as before this round: raw
  // apiPut + refetch (onChanged), no optimism, no relation to mobile's
  // setPick/toggle model below. Desktop layout and behavior are explicitly
  // out of scope for the mobile reframe.
  async function desktopPick(character: string, sourceEl?: HTMLElement) {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/draft/rooms/${room.id}/pick`, { slot_index: activeSlot, character });
      onChanged();
      setActiveSlot((prev) => Math.min(prev + 1, room.chars_per_player - 1));
      if (sourceEl && railRef.current) {
        const rowHeight = sourceEl.getBoundingClientRect().height + 6;
        railRef.current.scrollBy({ top: rowHeight, behavior: 'smooth' });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
  // character. Desktop only.
  function railItem(c: string) {
    const taken = pickedElsewhere.has(c);
    return (
      <button
        key={c}
        type="button"
        className={`draft-rail-item${c === activeCharacter ? ' selected' : ''}${taken ? ' taken' : ''}`}
        disabled={busy || !!activePick?.locked || taken}
        title={taken ? `Already picked for another slot` : undefined}
        onClick={(e) => desktopPick(c, e.currentTarget)}
      >
        <img src={charImgUrl(c)} alt={c} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        <span>{c}</span>
      </button>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // Mobile: picks are an unordered SET of N, not a sequence with a cursor.
  // Tapping an unpicked character fills the lowest-index empty slot; tapping
  // an already-picked one (grid, "More fighters" modal, or its own slot box)
  // removes it, leaving a hole rather than reflowing. There is no "current
  // slot" -- lastAddedSlot tracks only which character the big render shows,
  // purely a display concern, never a target for the next pick.
  // ══════════════════════════════════════════════════════════════════════

  const [lastAddedSlot, setLastAddedSlot] = useState<number | null>(null);
  const lastAddedInitialized = useRef(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [locking, setLocking] = useState(false);

  // A failed pick/clear rolls back silently otherwise -- from the player's
  // side that reads as a mis-tap, not a failure, and they learn nothing
  // (see applyAdd/applyRemove below). failedSlot flashes that specific slot
  // box red for a beat so a real failure looks like one. The timer ref is
  // cleared and restarted on every call (not just set-once) so two failures
  // on the same slot in quick succession each get the full flash duration
  // rather than the second failure's flash getting cut short by the first
  // failure's already-pending clear.
  const [failedSlot, setFailedSlot] = useState<number | null>(null);
  const failedSlotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashFailure(slotIndex: number) {
    if (failedSlotTimerRef.current) clearTimeout(failedSlotTimerRef.current);
    setFailedSlot(slotIndex);
    failedSlotTimerRef.current = setTimeout(() => setFailedSlot(null), 700);
  }

  // Seed once the real picks arrive (not on every myPicks change) -- a
  // mid-draft refresh should show whatever was already picked, not the
  // empty state, without this re-running every time a pick changes it.
  useEffect(() => {
    if (lastAddedInitialized.current || myPicks.length === 0) return;
    lastAddedInitialized.current = true;
    setLastAddedSlot(highestFilledIndex(myPicks));
  }, [myPicks]);

  // Hide the global bottom nav while actually picking -- eight nav
  // destinations under a single-action screen is a mis-tap risk, and this
  // screen now owns the whole viewport anyway (see .draft-select-mobile's
  // position: fixed below). Keyed explicitly on room.status rather than
  // this component's own mount/unmount: page.tsx only mounts this component
  // while status IS 'picking' today, so the two happen to coincide, but
  // depending on the status value directly means this stays correct even if
  // that coupling ever changes, instead of relying on it silently.
  useEffect(() => {
    if (!isMobile) return;
    const active = room.status === 'picking';
    document.body.classList.toggle('draft-picking-active', active);
    return () => {
      document.body.classList.remove('draft-picking-active');
    };
  }, [isMobile, room.status]);

  const pickedSlotByChar = useMemo(() => {
    const m = new Map<string, number>();
    myPicks.forEach((p, i) => {
      if (p.character) m.set(p.character, i);
    });
    return m;
  }, [myPicks]);

  async function applyAdd(slotIndex: number, character: string) {
    haptic([8]);
    const prior = lastAddedSlot;
    setLastAddedSlot(slotIndex);
    try {
      await setPick(slotIndex, character);
    } catch (e) {
      setError((e as Error).message);
      setLastAddedSlot(prior);
      flashFailure(slotIndex);
      haptic([15, 60, 15, 60, 15]); // distinct from the [8] success tap -- this one should feel like a failure
    }
  }

  async function applyRemove(slotIndex: number) {
    haptic([12, 30, 12]);
    const prior = lastAddedSlot;
    const nextSlots = myPicks.map((p, i) => (i === slotIndex ? { ...p, character: null } : p));
    setLastAddedSlot(highestFilledIndex(nextSlots));
    try {
      await setPick(slotIndex, null);
    } catch (e) {
      setError((e as Error).message);
      setLastAddedSlot(prior);
      flashFailure(slotIndex);
      haptic([15, 60, 15, 60, 15]);
    }
  }

  // The one entry point for every mobile tap-a-character gesture (grid tile
  // or "More fighters" modal row): fill lowest empty, or remove if already
  // picked, or (chars_per_player === 1 only) replace the single slot
  // outright, or -- full at N > 1 -- do nothing but pulse the slot row so
  // the tap still registers as *seen*, not silently dropped.
  async function toggleCharacter(character: string) {
    if (allLocked) return;
    const pickedIdx = pickedSlotByChar.get(character);
    if (pickedIdx != null) {
      if (myPicks[pickedIdx].locked) return;
      await applyRemove(pickedIdx);
      return;
    }
    const emptyIdx = myPicks.findIndex((p) => !p.character);
    if (emptyIdx !== -1) {
      await applyAdd(emptyIdx, character);
      return;
    }
    if (room.chars_per_player === 1) {
      if (myPicks[0]?.locked) return;
      await applyAdd(0, character);
      return;
    }
    setPulseKey((k) => k + 1);
  }

  function onSlotBoxTap(i: number) {
    const p = myPicks[i];
    if (!p || !p.character || p.locked) return; // empty or locked -- no-op
    applyRemove(i);
  }

  async function handleLockAll() {
    setLocking(true);
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
      setLocking(false);
    }
  }

  // Persistent picked badge (slot number) + tint -- distinct from
  // "currently shown in the render" (a separate, subtler ring), so a picked
  // character reads as picked everywhere it appears, whether or not it
  // happens to be the one currently big on screen.
  function mobileTile(c: string) {
    const slotIdx = pickedSlotByChar.get(c);
    const picked = slotIdx != null;
    const lockedHere = picked && myPicks[slotIdx].locked;
    const isRenderTarget = picked && lastAddedSlot === slotIdx;
    return (
      <button
        key={c}
        type="button"
        className={`draft-grid-tile${picked ? ' picked' : ''}${isRenderTarget ? ' render-target' : ''}`}
        disabled={allLocked || lockedHere}
        title={picked ? `Picked for slot ${slotIdx + 1} — tap to remove` : c}
        onClick={() => toggleCharacter(c)}
      >
        <img src={charImgUrl(c)} alt={c} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        {picked && <span className="draft-grid-tile-badge">{slotIdx + 1}</span>}
      </button>
    );
  }

  // "More fighters" modal's grid tile -- same toggle semantics as the
  // favorites grid (this is what makes a pick made in here undoable at all:
  // it isn't necessarily in the top-10 grid to tap again there). Desktop's
  // railItem is deliberately NOT reused -- it's built around the cursor
  // concept mobile no longer has. Not the same component as mobileTile
  // either: that one is icon-only (fixed 10-tile grid, no room for a label);
  // this one carries a name + Elo/record, needed once the grid covers the
  // full ~85-character roster instead of a curated 10. Both share the same
  // picked/locked/badge *state* (pickedSlotByChar, myPicks) -- only the
  // markup differs.
  //
  // 3-across with Elo + W-L record, chosen over a 4-across Elo-only variant
  // built for a side-by-side comparison: the extra column's scan-rate
  // advantage didn't survive contact (tall name+stat cards, not compact
  // icons -- ~12 tiles visible at 4-across vs. ~9 at 3-across, not the
  // ~24-vs-18 the raw tile math predicted), while 4-across couldn't fit
  // "Banjo & Kazooie" on one line and pushed same-row Elo numbers to
  // different baselines depending on whether a neighbor's name wrapped.
  // Most of the roster has no record at all for any one player -- that's
  // deliberately quiet here (blank, not a repeated "Unplayed" label), so the
  // few tiles that DO have a number are what stand out, rather than every
  // blank tile shouting equally.
  function modalGridItem(c: string) {
    const slotIdx = pickedSlotByChar.get(c);
    const picked = slotIdx != null;
    const lockedHere = picked && myPicks[slotIdx].locked;
    const stat = statsByChar.get(c);
    const statText = stat ? `${stat.elo} · ${stat.wins}-${stat.losses}` : '';
    return (
      <button
        key={c}
        type="button"
        className={`draft-roster-tile${picked ? ' picked' : ''}`}
        disabled={allLocked || lockedHere}
        title={picked ? `Picked for slot ${slotIdx + 1} — tap to remove` : c}
        onClick={() => toggleCharacter(c)}
      >
        <span className="draft-roster-tile-icon">
          <img src={charImgUrl(c)} alt={c} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
          {picked && <span className="draft-grid-tile-badge">{slotIdx + 1}</span>}
        </span>
        <span className="draft-roster-tile-name">{c}</span>
        <span className="draft-roster-tile-stat">{statText}</span>
      </button>
    );
  }

  const mobileRosterList = (
    <div className="draft-roster-grid">
      {pinnedFiltered.length > 0 && (
        <>
          <div className="draft-rail-divider">Your Favorites</div>
          {pinnedFiltered.map(modalGridItem)}
        </>
      )}
      {pinned.length === 0 && !q && (
        <div className="draft-rail-hint">
          No favorites yet —{' '}
          <a href="/favorites" target="_blank" rel="noopener noreferrer">
            set your favorites
          </a>{' '}
          to get a pinned section here.
        </div>
      )}
      {restFiltered.length > 0 && (
        <>
          <div className="draft-rail-divider">All Fighters</div>
          {restFiltered.map(modalGridItem)}
        </>
      )}
      {q && pinnedFiltered.length === 0 && restFiltered.length === 0 && (
        <div className="draft-rail-hint">No characters match &quot;{query}&quot;.</div>
      )}
    </div>
  );

  const desktopRosterList = (
    <div className="draft-rail" ref={railRef}>
      {pinnedFiltered.length > 0 && (
        <>
          <div className="draft-rail-divider">Your Favorites</div>
          {pinnedFiltered.map(railItem)}
        </>
      )}
      {pinned.length === 0 && !q && (
        <div className="draft-rail-hint">
          No favorites yet —{' '}
          <a href="/favorites" target="_blank" rel="noopener noreferrer">
            set your favorites
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
  );

  if (isMobile) {
    // The render target: the character the big background render shows.
    // Most recently added, or -- on a removal -- the highest-index slot
    // still filled; null once nothing is picked.
    const renderCharacter = lastAddedSlot != null ? myPicks[lastAddedSlot]?.character ?? null : null;
    const renderStat = renderCharacter ? stats.find((s) => s.character === renderCharacter) : undefined;
    const statLine = renderCharacter
      ? renderStat
        ? `${renderCharacter} · ${renderStat.wins}-${renderStat.losses} · ${renderStat.elo}`
        : `${renderCharacter} · Unplayed`
      : 'Pick a character to see stats';

    const filledCount = myPicks.filter((p) => p.character).length;
    const nextEmptyIndex = myPicks.findIndex((p) => !p.character);
    const lockLabel = allLocked ? 'Locked in ✓' : allFilled ? 'Lock in' : `Pick ${room.chars_per_player - filledCount} more`;

    const me = room.players.find((p) => p.id === myId);

    return (
      <div className="draft-select-mobile">
        <div className="draft-mobile-header">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt={me.username} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
          ) : (
            <div className="draft-mobile-header-avatar">{me?.username?.[0]?.toUpperCase() ?? '?'}</div>
          )}
          <span>{me?.username ?? 'You'}</span>
        </div>

        {room.chars_per_player > 1 && (
          <div className="draft-slot-row">
            {/* 4x2 grid at 8 slots (VALID_CHARS_PER_PLAYER is 1/4/8, so this
                is the only case that needs its own layout) -- a single flex
                row wraps 8 boxes into an uneven 7-then-1-orphan line on a
                real phone width. Both rows even at 4 across instead. 4 slots
                still fits one row unchanged. */}
            <div key={pulseKey} className={`draft-slot-progress${room.chars_per_player > 4 ? ' grid-4x2' : ''}${pulseKey ? ' pulse' : ''}`}>
              {myPicks.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className={`draft-slot-box${i === nextEmptyIndex ? ' next-target' : ''}${p.locked ? ' locked' : ''}${failedSlot === i ? ' failed' : ''}`}
                  disabled={!p.character}
                  title={p.locked ? 'Locked' : p.character ? 'Tap to remove this pick' : `Slot ${i + 1} — empty`}
                  onClick={() => onSlotBoxTap(i)}
                >
                  {p.character ? (
                    <img
                      src={charHeadUrl(p.character)}
                      alt={p.character}
                      onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
                    />
                  ) : (
                    <span className="draft-slot-box-num">{i + 1}</span>
                  )}
                  {p.locked && <span className="draft-slot-lock">🔒</span>}
                </button>
              ))}
            </div>
            <span className="draft-pick-count">{filledCount}/{room.chars_per_player} picked</span>
          </div>
        )}

        {/* .draft-mobile-stage: card on top (fixed to its own content
            height), the render target's full render filling all remaining
            stage height below it -- a flex column, not an absolute-
            positioned overlap, so the whole figure (head included) is
            always visible regardless of a given character's art
            proportions. object-position: bottom center means every
            character stands on the same baseline. */}
        <div className="draft-mobile-stage">
          <div className="draft-select-mobile-body">
            <div className="draft-grid-label">{mobileGridLabel}</div>
            <div className="draft-grid">{mobileGridChars.map(mobileTile)}</div>

            <Button variant="outline" className="draft-more-btn" onClick={() => setRosterOpen(true)}>
              More fighters
            </Button>

            <div className="draft-stat-line">{statLine}</div>
          </div>

          {renderCharacter && (
            <div className="draft-bg-portrait-wrap">
              <img className="draft-bg-portrait" src={charImgUrl(renderCharacter)} alt="" aria-hidden="true" />
            </div>
          )}
        </div>

        <Modal open={rosterOpen} onClose={() => setRosterOpen(false)} maxWidth={420} panelClassName="draft-roster-panel">
          <div className="draft-roster-modal">
            <div className="draft-roster-header">
              <input
                type="text"
                className="draft-rail-search"
                placeholder="Search characters…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {/* Same visual language as tournament/page.tsx's .vs-close ("✕
                  Close") -- not its absolute positioning, which was built for
                  a full-bleed modal this panel isn't. Static in a header row
                  next to the search box instead. */}
              <button type="button" className="roster-close-btn" onClick={() => setRosterOpen(false)}>
                ✕ Close
              </button>
            </div>
            {mobileRosterList}
          </div>
        </Modal>

        <div className="draft-mobile-lockbar">
          <Button disabled={!allFilled || allLocked || locking} onClick={handleLockAll} className="draft-lockin-mobile">
            {lockLabel}
          </Button>
          {error && <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</span>}
        </div>
      </div>
    );
  }

  const pickCountLabel =
    !allFilled && room.chars_per_player > 1 ? `${myPicks.filter((p) => p.character).length}/${room.chars_per_player} picked` : null;

  return (
    <div className="draft-select">
      {room.chars_per_player > 1 && (
        <div className="draft-slot-tabs">
          {myPicks.map((p, i) => (
            <Button key={i} variant={i === activeSlot ? 'primary' : 'outline'} onClick={() => setActiveSlot(i)}>
              {p.locked ? '🔒 ' : ''}
              Slot {i + 1}
            </Button>
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
        {desktopRosterList}

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
        <Button disabled={!allFilled || allLocked || busy} onClick={lockAll}>
          {allLocked ? 'Locked in ✓' : 'Lock in'}
        </Button>
        {pickCountLabel && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{pickCountLabel}</span>}
        {error && <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</span>}
      </div>
    </div>
  );
}
