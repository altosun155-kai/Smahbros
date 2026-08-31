// /tier-list — port of web/public/tier-list.html. Drag-and-drop tier board
// (S/A/B/C/D/F + Unranked), tap-to-assign for touch, unranked search filter,
// and a read-only "view someone else's tier list" section.
//
// The legacy page manipulates the DOM directly during drag (insertBefore on
// drop, a floating indicator div moved via insertBefore during dragover).
// This port keeps `zones` (an ordered char[] per tier) as React state and
// derives the drop position from real getBoundingClientRect() measurements
// exactly like the original, then updates state rather than moving DOM nodes
// -- same visual result, React stays in control of the DOM.
//
// One legacy behavior reproduced deliberately, not fixed: rankingToTierMap()
// only tracks char->tier, discarding within-tier order, and buildBoard()
// re-populates each tier by iterating the full ROSTER in a fixed order. So a
// custom drag order within a tier is only ever preserved for the current
// session -- reloading always re-sorts each tier back to roster order. This
// port's initial zones are built the same way (grouping SMASH_ROSTER by
// saved tier), so a reload has the identical "forgets custom order" behavior.
//
// One behavior NOT reproduced, because it can't be: the legacy tap-to-assign
// (mobile) feature is actually broken in production today. Tapping a tile
// sets a raw module-level `let tapSelectedChar`, and that click then bubbles
// to the zone's own click listener within the same synchronous dispatch --
// which sees the just-mutated variable, treats it as "a zone was tapped
// while something was selected," and immediately re-appends the tile to its
// own zone and clears the selection. Tap-to-assign self-cancels on every
// single tap; it's never actually usable. React's state updates don't take
// effect until the next render, so the equivalent bubbled zone onClick here
// still sees the *previous* tapSelectedChar (unset) during the same event --
// tap-to-assign works correctly in this port as a side effect of the
// platform's event/state model, not a deliberate fix.
'use client';

import { useRef, useState } from 'react';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, apiPut, showToast } from '../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../lib/chars';
import './tier-list.css';

type Tier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
type Zone = Tier | 'unranked';

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D', 'F'];
const ALL_ZONES: Zone[] = [...TIERS, 'unranked'];
const TIER_COLORS: Record<Tier, string> = { S: '#ff7f7f', A: '#ffbf7f', B: '#ffff7f', C: '#7fff7f', D: '#7fbfff', F: '#bf7fff' };

function emptyZones(): Record<Zone, string[]> {
  return { S: [], A: [], B: [], C: [], D: [], F: [], unranked: [...SMASH_ROSTER] };
}

// Builds zones from a saved ranking the same way the legacy page's
// rankingToTierMap() + buildBoard() combination does: char->tier lookup,
// then walk the roster in its fixed order to populate each zone.
function zonesFromRanking(ranking: Partial<Record<Tier, string[]>> | undefined): Record<Zone, string[]> {
  const tierOf: Record<string, Tier> = {};
  if (ranking) {
    TIERS.forEach((t) => {
      (ranking[t] || []).forEach((c) => {
        tierOf[c] = t;
      });
    });
  }
  const zones = emptyZones();
  zones.unranked = [];
  SMASH_ROSTER.forEach((char) => {
    const zone: Zone = tierOf[char] || 'unranked';
    zones[zone].push(char);
  });
  return zones;
}

function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
}

function CharTile({
  char,
  size = 54,
  dragging,
  tapSelected,
  hidden,
  onDragStart,
  onDragEnd,
  onTapClick,
}: {
  char: string;
  size?: number;
  dragging: boolean;
  tapSelected: boolean;
  hidden?: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTapClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const classes = ['char-tile', dragging ? 'dragging' : '', tapSelected ? 'tap-selected' : ''].filter(Boolean).join(' ');
  const url = charImgUrl(char);
  const shortName = char.length > 6 ? char.slice(0, 5) + '…' : char;

  return (
    <div
      className={classes}
      draggable
      data-char={char}
      title={char}
      style={{ width: size, height: size, ...(hidden ? { display: 'none' } : {}) }}
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (isTouchDevice()) onTapClick();
      }}
    >
      {url && !imgFailed ? <img src={url} alt={char} onError={() => setImgFailed(true)} /> : <div className="char-fallback">{shortName}</div>}
    </div>
  );
}

interface DragIndicator {
  zone: Zone;
  beforeChar: string | null; // null = append to end
}

export default function TierListPage() {
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<Record<Zone, string[]>>(emptyZones());
  const [lastSaved, setLastSaved] = useState('');
  const [users, setUsers] = useState<{ username: string }[]>([]);

  const [unrankedSearch, setUnrankedSearch] = useState('');
  const [draggedChar, setDraggedChar] = useState<string | null>(null);
  const [dragIndicator, setDragIndicator] = useState<DragIndicator | null>(null);
  const [dragOverZone, setDragOverZone] = useState<Zone | null>(null);

  const [tapSelectedChar, setTapSelectedChar] = useState<string | null>(null);

  const [viewUsername, setViewUsername] = useState('');
  const [viewed, setViewed] = useState<{ username: string; ranking: Partial<Record<Tier, string[]>> } | null>(null);

  const initedRef = useRef(false);
  if (!initedRef.current) {
    initedRef.current = true;
    (async () => {
      try {
        const usersRes = await apiGet<{ username: string }[]>('/users/all');
        setUsers(usersRes || []);
      } catch {
        // same silent catch as the original
      }
      try {
        const data = await apiGet<{ ranking?: Partial<Record<Tier, string[]>>; updated_at?: string | null }>('/characters/ranking');
        if (data && data.ranking) {
          setZones(zonesFromRanking(data.ranking));
          if (data.updated_at) setLastSaved('Last saved: ' + new Date(data.updated_at).toLocaleString());
        }
      } catch {
        // no saved ranking yet -- everything stays unranked
      }
      setLoading(false);
    })();
  }

  function clearTapMode() {
    setTapSelectedChar(null);
  }

  // Mirrors getInsertTarget(): groups a zone's real tile rects into visual
  // rows (10px top tolerance), finds the closest row by vertical midpoint,
  // then the first tile in that row whose left-midpoint is right of the
  // cursor. Returns the char to insert before, or null to append.
  function getInsertBeforeChar(zoneEl: HTMLElement, excludeChar: string | null, clientX: number, clientY: number): string | null {
    const tileEls = Array.from(zoneEl.querySelectorAll<HTMLElement>('[data-char]')).filter((el) => el.dataset.char !== excludeChar);
    if (!tileEls.length) return null;

    const rows: { top: number; tiles: { char: string; rect: DOMRect }[] }[] = [];
    for (const el of tileEls) {
      const rect = el.getBoundingClientRect();
      const top = rect.top;
      const row = rows.find((r) => Math.abs(r.top - top) <= 10);
      const entry = { char: el.dataset.char as string, rect };
      if (row) row.tiles.push(entry);
      else rows.push({ top, tiles: [entry] });
    }

    let bestRow = rows[0];
    let bestDist = Infinity;
    for (const row of rows) {
      const mid = row.tiles[0].rect.top + row.tiles[0].rect.height / 2;
      const dist = Math.abs(clientY - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestRow = row;
      }
    }

    for (const { char, rect } of bestRow.tiles) {
      if (clientX < rect.left + rect.width / 2) return char;
    }

    const rowIdx = rows.indexOf(bestRow);
    if (rowIdx < rows.length - 1) return rows[rowIdx + 1].tiles[0].char;
    return null;
  }

  function moveChar(char: string, targetZone: Zone, beforeChar: string | null) {
    setZones((prev) => {
      const next: Record<Zone, string[]> = { ...prev };
      ALL_ZONES.forEach((z) => {
        next[z] = next[z].filter((c) => c !== char);
      });
      const dest = [...next[targetZone]];
      if (beforeChar) {
        const idx = dest.indexOf(beforeChar);
        dest.splice(idx === -1 ? dest.length : idx, 0, char);
      } else {
        dest.push(char);
      }
      next[targetZone] = dest;
      return next;
    });
  }

  function zoneDragOverProps(zone: Zone) {
    return {
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverZone(zone);
        const beforeChar = getInsertBeforeChar(e.currentTarget, draggedChar, e.clientX, e.clientY);
        setDragIndicator({ zone, beforeChar });
      },
      onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOverZone((prev) => (prev === zone ? null : prev));
          setDragIndicator((prev) => (prev?.zone === zone ? null : prev));
        }
      },
      onDrop: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverZone(null);
        setDragIndicator(null);
        if (!draggedChar) return;
        const beforeChar = getInsertBeforeChar(e.currentTarget, draggedChar, e.clientX, e.clientY);
        moveChar(draggedChar, zone, beforeChar);
      },
      onClick: () => {
        if (!tapSelectedChar) return;
        moveChar(tapSelectedChar, zone, null); // tap-to-assign always appends, matches original
        clearTapMode();
      },
    };
  }

  function renderZoneTiles(zone: Zone, chars: string[], size = 54, isHidden?: (char: string) => boolean) {
    const nodes: React.ReactNode[] = [];
    chars.forEach((char) => {
      if (dragIndicator?.zone === zone && dragIndicator.beforeChar === char) {
        nodes.push(<div key={`ind-${char}`} className="drop-indicator" />);
      }
      nodes.push(
        <CharTile
          key={char}
          char={char}
          size={size}
          dragging={draggedChar === char}
          tapSelected={tapSelectedChar === char}
          hidden={isHidden?.(char)}
          onDragStart={() => setDraggedChar(char)}
          onDragEnd={() => {
            setDraggedChar(null);
            setDragIndicator(null);
            setDragOverZone(null);
          }}
          onTapClick={() => {
            if (tapSelectedChar === char) {
              clearTapMode();
              return;
            }
            setTapSelectedChar(char);
            showToast(char, 'info', 1500);
          }}
        />
      );
    });
    if (dragIndicator?.zone === zone && dragIndicator.beforeChar === null) {
      nodes.push(<div key="ind-end" className="drop-indicator" />);
    }
    return nodes;
  }

  async function saveTierList() {
    try {
      const ranking: Record<Zone, string[]> = { ...zones };
      await apiPut('/characters/ranking', { ranking });
      showToast('Tier list saved!', 'success');
      setLastSaved('Last saved: just now');
    } catch (err) {
      showToast('Error saving: ' + (err as Error).message, 'error');
    }
  }

  function resetTierList() {
    if (!confirm('Move all characters back to Unranked?')) return;
    setZones(emptyZones());
  }

  async function viewUserTierList() {
    const username = viewUsername.trim();
    if (!username) {
      showToast('Enter a username.', 'warn');
      return;
    }
    try {
      const data = await apiGet<{ username: string; ranking: Partial<Record<Tier, string[]>> }>(`/characters/ranking/${username}`);
      setViewed(data);
    } catch (err) {
      showToast('Error loading tier list: ' + (err as Error).message, 'error');
    }
  }

  const q = unrankedSearch.trim().toLowerCase();

  return (
    <PageContainer>
      <PageHeader>
        <h1>🎖️ My Tier List</h1>
        <p>Drag character icons into tiers. Hover a character to see their name.</p>
      </PageHeader>

      {loading && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading tier list…</span>
        </div>
      )}

      {!loading && (
        <div>
          <div className="top-bar">
            <button type="button" className="btn btn-primary" onClick={saveTierList}>
              Save Tier List
            </button>
            <button type="button" className="btn btn-outline" onClick={resetTierList}>
              Reset All
            </button>
            <span className="last-saved">{lastSaved}</span>
          </div>
          <div id="tapModeBar" style={{ display: tapSelectedChar ? 'block' : 'none' }}>
            Tap a tier to place — tap again to cancel
          </div>

          <div className="tier-board">
            {TIERS.map((tier) => (
              <div key={tier} className="tier-row">
                <div className="tier-label" style={{ background: TIER_COLORS[tier] }}>
                  {tier}
                </div>
                <div className={`tier-zone${dragOverZone === tier ? ' drag-over' : ''}${tapSelectedChar ? ' tap-target' : ''}`} {...zoneDragOverProps(tier)}>
                  {renderZoneTiles(tier, zones[tier])}
                </div>
              </div>
            ))}

            <div className="unranked-section">
              <div className="unranked-label">Unranked — drag into a tier above</div>
              <input
                type="text"
                className="unranked-search"
                placeholder="Search characters…"
                value={unrankedSearch}
                onChange={(e) => setUnrankedSearch(e.target.value)}
              />
              <div className={`unranked-zone${dragOverZone === 'unranked' ? ' drag-over' : ''}${tapSelectedChar ? ' tap-target' : ''}`} {...zoneDragOverProps('unranked')}>
                {renderZoneTiles('unranked', zones.unranked, 54, (char) => !!q && !char.toLowerCase().includes(q))}
              </div>
            </div>
          </div>

          <hr className="section-divider" style={{ marginTop: 32 }} />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>View someone else&apos;s tier list</h2>
          <div className="view-user-row">
            <select
              value={viewUsername}
              onChange={(e) => setViewUsername(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.9rem' }}
            >
              <option value="">Select player…</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.username}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-outline" onClick={viewUserTierList}>
              View
            </button>
          </div>
          {viewed && (
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>{viewed.username}&apos;s Tier List</h3>
              <div>
                {TIERS.map((tier) => {
                  const chars = viewed.ranking?.[tier] || [];
                  if (!chars.length) return null;
                  return (
                    <div key={tier} className="vt-row">
                      <div className="vt-label" style={{ background: TIER_COLORS[tier] }}>
                        {tier}
                      </div>
                      {chars.map((char) => (
                        <VtTile key={char} char={char} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function VtTile({ char }: { char: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = charImgUrl(char);
  const shortName = char.length > 6 ? char.slice(0, 5) + '…' : char;
  return (
    <div className="vt-tile" title={char}>
      {url && !imgFailed ? <img src={url} alt={char} onError={() => setImgFailed(true)} /> : <div className="char-fallback">{shortName}</div>}
    </div>
  );
}
