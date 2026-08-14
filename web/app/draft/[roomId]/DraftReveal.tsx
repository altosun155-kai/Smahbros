'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import { charImgUrl } from '../../lib/chars';
import { haptic } from '../../lib/haptics';
import type { DraftRoomState } from '../../lib/useDraftRoom';
import DraftBracketPreview, { type BracketSummary } from './DraftBracketPreview';

const MIN_REVEAL_MS = 1800;

export default function DraftReveal({ room }: { room: DraftRoomState }) {
  const [phase, setPhase] = useState<'reveal' | 'bracket'>('reveal');
  const [brackets, setBrackets] = useState<BracketSummary[] | null>(null);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const transitionedRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Fire once when the reveal screen appears -- all connected clients receive the
  // same WS push at (effectively) the same instant, so this fires in sync across devices.
  useEffect(() => {
    haptic();
  }, []);

  // Pre-fetch the bracket data during the reveal display so the Flip transition's
  // destination content is already available -- no async gap once the swap starts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(room.bracket_ids.map((id) => apiGet<BracketSummary>(`/brackets/${id}`)));
        if (!cancelled) setBrackets(results);
      } catch {
        // fall through -- DraftBracketPreview will retry its own fetch if this failed
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room.bracket_ids]);

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_REVEAL_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (transitionedRef.current || !minTimeElapsed || !brackets) return;
    transitionedRef.current = true;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      if (reducedMotion) {
        setPhase('bracket');
        return;
      }
      const { gsap } = await import('gsap');
      const { Flip } = await import('gsap/Flip');
      gsap.registerPlugin(Flip);

      const state = Flip.getState('[data-flip-id]');
      setPhase('bracket');
      requestAnimationFrame(() => {
        // Roadmap spec: 200ms between player clusters, 40ms between characters
        // within a cluster. Flip.from()'s own `stagger` is a single flat value, so
        // clusters get one Flip.from() call each with an increasing base `delay`,
        // and the 40ms intra-cluster stagger is applied within each of those calls.
        const playerIds = Array.from(new Set(room.players.map((p) => String(p.id))));
        playerIds.forEach((pid, clusterIndex) => {
          Flip.from(state, {
            targets: `[data-flip-id^="portrait-${pid}-"]`,
            duration: 0.7,
            ease: 'power2.inOut',
            absolute: true,
            stagger: 0.04,
            delay: clusterIndex * 0.2,
          });
        });
      });
    })();
  }, [minTimeElapsed, brackets]);

  if (phase === 'bracket') {
    return <DraftBracketPreview room={room} brackets={brackets ?? undefined} />;
  }

  const slots = Array.from({ length: room.num_players });
  const clusterClass =
    room.chars_per_player === 1 ? 'draft-reveal-picks-1' : room.chars_per_player === 4 ? 'draft-reveal-picks-4' : 'draft-reveal-picks-8';

  return (
    <div className="draft-reveal-grid" ref={gridRef}>
      {slots.map((_, i) => {
        const p = room.players[i];
        if (!p) {
          return (
            <div key={i} className="draft-reveal-corner">
              <div className="draft-avatar-empty" style={{ width: 56, height: 56, borderRadius: '50%' }} />
            </div>
          );
        }
        const picks = room.picks[String(p.id)] || [];
        return (
          <div key={i} className="draft-reveal-corner">
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{p.username}</span>
            <div className={clusterClass}>
              {picks.map((pick) => (
                <img
                  key={pick.slot_index}
                  data-flip-id={`portrait-${p.id}-${pick.slot_index}`}
                  src={pick.character ? charImgUrl(pick.character) : ''}
                  alt={pick.character ?? ''}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--card-bg2)', borderRadius: 8 }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
