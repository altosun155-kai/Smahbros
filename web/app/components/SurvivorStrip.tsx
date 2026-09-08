'use client';

// SurvivorStrip — a compact "who's still in" row for a free-pool bracket,
// shown on tournament/page.tsx (the live, multi-device bracket view) and
// bracket/page.tsx (the manual single-user builder/scorer). Riding whatever
// refresh mechanism each caller already has: this component takes plain,
// already-fetched/already-local data as props and re-renders whenever its
// caller does -- no fetch, no WebSocket, no polling of its own.
//
// Compact by default (name + alive/total), tap a pill to expand into head
// icons of that player's still-alive characters. Zero-survivor players stay
// in the strip reading e.g. "kai 0/4" -- never hidden, per spec. Hidden
// entirely when charsPerPlayer <= 1 (a row of 1s and 0s would just
// duplicate what the bracket itself already shows).
// Styled inline, not via a page-specific CSS file -- this component is
// shared across tournament.css and bracket.css's separate stylesheets, and
// BracketOptionsPicker.tsx (the other cross-page-shared component here)
// follows the same inline-styles-plus-CSS-vars convention rather than
// adding a third stylesheet import.
import { useState } from 'react';
import { charHeadUrl } from '../lib/chars';
import { computeSurvivors, type PlayerSurvival } from '../lib/bracketSurvivors';

export default function SurvivorStrip({
  bracketData,
  roundWinners,
  players,
  charsPerPlayer,
}: {
  bracketData: { a: string | null; b: string | null }[];
  roundWinners: Record<string, string>;
  players: string[];
  charsPerPlayer: number;
}) {
  // Hook has to run unconditionally, above both early returns below.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (charsPerPlayer <= 1) return null;

  let survivors: PlayerSurvival[];
  try {
    survivors = computeSurvivors(bracketData, roundWinners, players);
  } catch (e) {
    // Not necessarily a bug -- on bracket/page.tsx the player-list textarea
    // stays editable after a bracket is generated, so this is a real,
    // reachable state a host can cause on purpose, not only evidence of a
    // key-format regression. Logged with the real mismatch so a genuine
    // bug is still diagnosable, but the visible message says what to do
    // rather than just what happened. Scoped to this component -- the rest
    // of the page (matches, scoring, connectors) keeps working either way.
    console.error('[SurvivorStrip] player/label mismatch', e);
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: '0.82rem',
          color: 'var(--text-muted)',
        }}
      >
        Player list has changed since this bracket was generated — regenerate the bracket to see survivor counts.
      </div>
    );
  }

  function toggle(player: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(player)) next.delete(player);
      else next.add(player);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
      {survivors.map((s) => {
        const isExpanded = expanded.has(s.player);
        const isOut = s.alive === 0;
        return (
          <div
            key={s.player}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              background: isOut ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => toggle(s.player)}
              aria-expanded={isExpanded}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 14px',
                fontFamily: 'inherit',
                color: isOut ? 'var(--text-muted)' : 'var(--text)',
              }}
            >
              <span style={{ fontSize: '0.82rem', fontWeight: 700, opacity: isOut ? 0.55 : 1 }}>{s.player}</span>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: isOut ? '#e74c3c' : '#27ae60',
                  opacity: isOut ? 0.75 : 1,
                }}
              >
                {s.alive}/{s.total}
              </span>
            </button>
            {isExpanded && (
              <div style={{ display: 'flex', gap: 4, padding: '0 10px 8px', flexWrap: 'wrap' }}>
                {s.aliveChars.length === 0 ? (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No characters left</span>
                ) : (
                  s.aliveChars.map((c) => (
                    <img
                      key={c}
                      src={charHeadUrl(c)}
                      alt={c}
                      title={c}
                      style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 5, background: 'var(--card-bg)' }}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
