// /favorites — port of web/public/favorites.html. Pick up to 10 favorite
// characters (chips grid + search), reordered into a "power ranking" list by
// pick order, saved via PUT /characters/favorites.
//
// Reuses SMASH_ROSTER + charImgUrl from lib/chars.ts rather than re-typing
// the 87-character roster array a second time -- the exact "duplicated
// constant drifting" pattern CLAUDE.md's Working Conventions calls out.
'use client';

import { useEffect, useMemo, useState } from 'react';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiGet, apiPut, showToast } from '../lib/api';
import { charImgUrl, SMASH_ROSTER } from '../lib/chars';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './favorites.css';

const MAX_FAVORITES = 10;

export default function FavoritesPage() {
  useDocumentTitle('Smash Bracket — Top 10 Favorites');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]); // insertion order = rank order
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet<{ characters?: string[] }>('/characters/favorites');
        if (data && data.characters) setSelected(data.characters.slice(0, MAX_FAVORITES));
      } catch {
        // same silent catch as the original -- no favorites yet is not an error
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const full = selected.length >= MAX_FAVORITES;

  const q = search.toLowerCase().trim();
  const visibleRoster = q ? SMASH_ROSTER.filter((c) => c.toLowerCase().includes(q)) : SMASH_ROSTER;

  function toggleChar(char: string) {
    setSelected((prev) => {
      if (prev.includes(char)) return prev.filter((c) => c !== char);
      if (prev.length >= MAX_FAVORITES) {
        showToast('Maximum 10 favorites allowed.', 'warn');
        return prev;
      }
      return [...prev, char];
    });
  }

  function clearAll() {
    setSelected([]);
  }

  async function saveFavorites() {
    try {
      await apiPut('/characters/favorites', { characters: selected });
      showToast('Favorites saved!', 'success');
    } catch (err) {
      showToast('Error saving: ' + (err as Error).message, 'error');
    }
  }

  return (
    <PageContainer>
      <PageHeader>
        <h1>⭐ Top 10 Favorite Characters</h1>
        <p>Pick up to 10 of your favorite Smash Ultimate fighters.</p>
      </PageHeader>

      {loading && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading favorites…</span>
        </div>
      )}

      {!loading && (
        <div>
          <div className="counter">
            <span>{selected.length}</span>/10 selected
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search characters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'var(--card-bg2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 16,
                width: 220,
                outline: 'none',
                transition: 'border-color .15s',
              }}
            />
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                borderRadius: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Clear
            </button>
          </div>

          <div className="chips-grid">
            {visibleRoster.map((char) => {
              const isSelected = selectedSet.has(char);
              return (
                <span
                  key={char}
                  className={`char-chip${isSelected ? ' selected' : ''}${!isSelected && full ? ' disabled' : ''}`}
                  onClick={() => toggleChar(char)}
                >
                  {char}
                </span>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 32 }}>
            <button type="button" className="btn btn-primary" onClick={saveFavorites}>
              Save Favorites
            </button>
            <button type="button" className="btn btn-outline" onClick={clearAll}>
              Clear All
            </button>
          </div>

          {selected.length > 0 && (
            <div>
              <h2
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 12,
                }}
              >
                Your Power Rankings
              </h2>
              <ul className="power-list">
                {selected.map((c, i) => {
                  const rankClass = i === 0 ? 'power-rank-1' : i === 1 ? 'power-rank-2' : i === 2 ? 'power-rank-3' : 'power-rank-n';
                  const rankLabel = `#${i + 1}`;
                  return (
                    <li key={c} className="power-item">
                      <span className={`power-rank ${rankClass}`}>{rankLabel}</span>
                      <img
                        className="power-char-img"
                        src={charImgUrl(c)}
                        alt={c}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <span className="power-char-name">{c}</span>
                      <button type="button" className="power-remove" onClick={() => toggleChar(c)}>
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
