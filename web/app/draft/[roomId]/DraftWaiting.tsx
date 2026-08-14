'use client';

import type { DraftRoomState } from '../../lib/useDraftRoom';

function isFullyLocked(room: DraftRoomState, playerId: number): boolean {
  const picks = room.picks[String(playerId)];
  if (!picks) return false;
  return picks.length === room.chars_per_player && picks.every((p) => p.locked);
}

export default function DraftWaiting({ room }: { room: DraftRoomState }) {
  const slots = Array.from({ length: room.num_players });
  const heading = room.status === 'revealed' ? "Everyone's locked in!" : 'Waiting for the others…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', padding: '32px 0' }}>
      <h2 style={{ fontFamily: 'var(--font-display)' }}>{heading}</h2>
      <div className="draft-avatar-grid">
        {slots.map((_, i) => {
          const p = room.players[i];
          const locked = p ? isFullyLocked(room, p.id) : false;
          return (
            <div key={i} className="draft-avatar-slot">
              {p ? (
                <>
                  <div style={{ position: 'relative' }}>
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.username} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    ) : (
                      <div className="draft-avatar-placeholder">{p.username[0]?.toUpperCase()}</div>
                    )}
                    {locked && <span className="draft-lock-badge">🔒</span>}
                  </div>
                  <span>{p.username}</span>
                </>
              ) : (
                <div className="draft-avatar-empty">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
