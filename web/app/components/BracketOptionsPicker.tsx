// BracketOptionsPicker — React port of bracket-options.js's
// renderBracketOptions()/readBracketOptions(). Controlled component instead
// of a DOM-injected radio group read back via querySelector; the "Character
// Pool" setting is still gone (poolMode is always 'slot'), same as the
// original comment notes.
'use client';

import type { BracketStyle, SeedMode } from '../lib/bracketEngine';

export interface BracketOptionsValue {
  style: BracketStyle;
  seedMode: SeedMode;
}

export default function BracketOptionsPicker({ value, onChange }: { value: BracketOptionsValue; onChange: (v: BracketOptionsValue) => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Bracket Style</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 10, background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
          {(
            [
              ['strongVsStrong', 'Strong vs Strong', 'highest plays highest'],
              ['strongVsWeak', 'Strong vs Weak', 'highest plays lowest'],
              ['random', 'Random', 'fully shuffled'],
            ] as const
          ).map(([v, label, sub]) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
              <input type="radio" name="bracketStyle" checked={value.style === v} onChange={() => onChange({ ...value, style: v })} style={{ accentColor: 'var(--accent-blue)' }} />
              <span>
                <strong>{label}</strong> — {sub}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Seeding (Rank By)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 10, background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
            <input type="radio" name="seedMode" checked={value.seedMode === 'elo'} onChange={() => onChange({ ...value, seedMode: 'elo' })} style={{ accentColor: 'var(--accent-blue)' }} />
            <span>
              <strong>Elo</strong> — rank by Elo rating
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
            <input type="radio" name="seedMode" checked={value.seedMode === 'kills'} onChange={() => onChange({ ...value, seedMode: 'kills' })} style={{ accentColor: 'var(--accent-blue)' }} />
            <span>
              <strong>Kills</strong> — rank by total stocks taken
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
            <input type="radio" name="seedMode" checked={value.seedMode === 'winpct'} onChange={() => onChange({ ...value, seedMode: 'winpct' })} style={{ accentColor: 'var(--accent-blue)' }} />
            <span>
              <strong>Win %</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>(min 3 games)</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
