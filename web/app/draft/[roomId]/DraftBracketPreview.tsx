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
      {brackets.map((b, slot) => (
        <div key={b.id} className="draft-bracket-panel">
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 10, fontSize: '0.95rem' }}>Bracket</h3>
          {b.bracket_data.map((pair, mi) => {
            const aPlayer = parseLabel(pair.a).player;
            const bPlayer = parseLabel(pair.b).player;
            const aId = aPlayer ? usernameToId[aPlayer] : undefined;
            const bId = bPlayer ? usernameToId[bPlayer] : undefined;
            return (
              <div key={mi} className="draft-bracket-match">
                <BracketEntry label={pair.a} flipId={aId != null ? `portrait-${aId}-${slot}` : undefined} />
                <BracketEntry label={pair.b} flipId={bId != null ? `portrait-${bId}-${slot}` : undefined} />
              </div>
            );
          })}
          <a className="btn btn-primary" href={`/tournament.html?id=${b.id}`} style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>
            Open Bracket
          </a>
        </div>
      ))}
    </div>
  );
}
