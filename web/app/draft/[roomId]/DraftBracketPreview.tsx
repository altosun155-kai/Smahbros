'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { charImgUrl } from '../../lib/chars';
import type { DraftRoomState } from '../../lib/useDraftRoom';

export interface BracketSummary {
  id: number;
  bracket_data: { a: string; b: string }[];
}

function parseLabel(label: string): { player: string | null; character: string | null } {
  if (!label || label.toUpperCase() === 'BYE') return { player: null, character: null };
  const parts = label.split(' — ');
  if (parts.length < 2) return { player: null, character: null };
  return { player: parts[0].trim(), character: parts.slice(1).join(' — ').trim() };
}

// The reveal screen's flip ids are keyed by each pick's *original* slot_index
// (portrait-{playerId}-{slot_index}, set from room.picks). The backend's
// _deal_bracket() shuffles each player's own pick order before seeding the
// bracket (see routers/draft.py), so a bracket match's position tells us
// nothing about which original slot a character came from -- and bracket_data
// carries only "username — character" labels, no slot_index. Character names
// are unique per player (the backend rejects picking the same character into
// two slots), so looking the character back up in room.picks recovers the
// correct original slot_index and lets the flip id match the reveal side
// exactly. This replaced an earlier version keyed off the bracket-panel
// index, which collapsed every one of a player's picks onto the same id
// whenever a room only ever has one live bracket (always, today) -- broke
// Flip's from/to matching for any chars_per_player > 1.
function pickSlotFor(room: DraftRoomState, playerId: number, character: string | null): number | undefined {
  if (character == null) return undefined;
  return (room.picks[String(playerId)] || []).find((p) => p.character === character)?.slot_index;
}

function BracketEntry({ label, flipId }: { label: string; flipId?: string }) {
  const { player, character } = parseLabel(label);
  if (!player) {
    return (
      <div className="draft-bracket-entry" style={{ opacity: 0.5, fontStyle: 'italic' }}>
        BYE
      </div>
    );
  }
  return (
    <div className="draft-bracket-entry">
      {character && <img data-flip-id={flipId} src={charImgUrl(character)} alt={character} style={{ width: 20, height: 20, objectFit: 'contain' }} />}
      <span>
        {player} — {character}
      </span>
    </div>
  );
}

export default function DraftBracketPreview({
  room,
  brackets: providedBrackets,
}: {
  room: DraftRoomState;
  brackets?: BracketSummary[];
}) {
  const [fetchedBrackets, setFetchedBrackets] = useState<BracketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const brackets = providedBrackets ?? fetchedBrackets;

  useEffect(() => {
    if (providedBrackets) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(room.bracket_ids.map((id) => apiGet<BracketSummary>(`/brackets/${id}`)));
        if (!cancelled) setFetchedBrackets(results);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.bracket_ids, providedBrackets]);

  const usernameToId: Record<string, number> = {};
  room.players.forEach((p) => (usernameToId[p.username] = p.id));

  if (error) return <div style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</div>;

  return (
    <div
      className={room.bracket_ids.length > 1 ? 'draft-bracket-carousel' : undefined}
      style={room.bracket_ids.length === 1 ? { display: 'flex', justifyContent: 'center' } : undefined}
    >
      {brackets.map((b) => (
        <div key={b.id} className="draft-bracket-panel">
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 10, fontSize: '0.95rem' }}>Bracket</h3>
          {b.bracket_data.map((pair, mi) => {
            const { player: aPlayer, character: aChar } = parseLabel(pair.a);
            const { player: bPlayer, character: bChar } = parseLabel(pair.b);
            const aId = aPlayer ? usernameToId[aPlayer] : undefined;
            const bId = bPlayer ? usernameToId[bPlayer] : undefined;
            const aSlot = aId != null ? pickSlotFor(room, aId, aChar) : undefined;
            const bSlot = bId != null ? pickSlotFor(room, bId, bChar) : undefined;
            return (
              <div key={mi} className="draft-bracket-match">
                <BracketEntry label={pair.a} flipId={aId != null && aSlot != null ? `portrait-${aId}-${aSlot}` : undefined} />
                <BracketEntry label={pair.b} flipId={bId != null && bSlot != null ? `portrait-${bId}-${bSlot}` : undefined} />
              </div>
            );
          })}
          <a className="btn btn-primary" href={`/tournament?id=${b.id}`} style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>
            Open Bracket
          </a>
        </div>
      ))}
    </div>
  );
}
