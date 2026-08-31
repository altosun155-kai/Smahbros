// /my-brackets — port of web/public/my-brackets.html. List of saved
// brackets with expand/collapse, status badge, view link, and delete.
//
// Two things noted (not fixed) while porting, since this is meant to be a
// port, not a redesign:
// - GET /brackets (routers/brackets.py:214) doesn't return bracket_data, so
//   the legacy page's `hasLineup` check (`isLive && !(b.bracket_data && ...)`)
//   always evaluates to just `isLive` in practice -- the "🔴 Live" badge
//   branch is unreachable, "📋 Lineup" always wins for any live bracket. This
//   port reproduces that exact formula/behavior rather than "fixing" it,
//   since the correct fix depends on intent the page migration doesn't own.
// - The legacy page's per-match `matches` HTML string is built but never
//   actually interpolated into the returned template -- genuinely dead code,
//   not just unreachable. Not carried over (nothing observable changes).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiDelete, apiGet, showToast } from '../lib/api';
import './my-brackets.css';

interface BracketSummary {
  id: number;
  name: string;
  mode: string | null;
  is_live: boolean;
  winner: string | null;
  placements: Record<string, unknown> | null;
  created_at: string;
}

export default function MyBracketsPage() {
  const [loading, setLoading] = useState(true);
  const [brackets, setBrackets] = useState<BracketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  async function loadBrackets() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<BracketSummary[]>('/brackets');
      setBrackets(data);
    } catch (err) {
      setError((err as Error).message);
      showToast('Error loading brackets: ' + (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBrackets();
  }, []);

  function toggle(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteBracket(id: number, name: string) {
    if (!confirm(`Delete bracket "${name}"?`)) return;
    try {
      await apiDelete(`/brackets/${id}`);
      showToast('Bracket deleted.', 'success');
      loadBrackets();
    } catch (err) {
      showToast('Error deleting: ' + (err as Error).message, 'error');
    }
  }

  function statusBadge(b: BracketSummary) {
    const isLive = b.is_live;
    const hasWinner = !!b.winner;
    // See the file-level note -- b.bracket_data is never present on this
    // endpoint, so this reduces to exactly `isLive`, same as the original.
    const hasLineup = isLive;
    const endedEarly = !isLive && !hasWinner && b.placements !== null && b.placements !== undefined;

    if (isLive && hasLineup) return <span className="status-badge status-progress">📋 Lineup</span>;
    if (isLive) return <span className="status-badge status-live">🔴 Live</span>;
    if (hasWinner) return <span className="status-badge status-done">🏆 {b.winner}</span>;
    if (endedEarly) return <span className="status-badge status-ended">Ended</span>;
    return <span className="status-badge status-progress">In Progress</span>;
  }

  return (
    <PageContainer>
      <PageHeader>
        <h1>📁 My Saved Brackets</h1>
        <p>All your saved single-elimination brackets.</p>
      </PageHeader>

      {loading && (
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading brackets…</span>
        </div>
      )}

      {!loading && !error && brackets && brackets.length > 0 && (
        <div style={{ maxWidth: 800 }}>
          {brackets.map((b) => {
            const isOpen = openIds.has(b.id);
            return (
              <div key={b.id} className="bracket-item">
                <div className="bracket-header" onClick={() => toggle(b.id)}>
                  <div>
                    <div className="bracket-name">{b.name}</div>
                    <div className="bracket-meta">
                      {b.mode || 'regular'} · {b.created_at ? new Date(b.created_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <div className="bracket-actions">
                    {statusBadge(b)}
                    <Link
                      href={`/tournament?id=${b.id}`}
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: '0.75rem' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      className="btn-trash"
                      title="Delete bracket"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteBracket(b.id, b.name);
                      }}
                    >
                      🗑
                    </button>
                    <span className={`expand-icon${isOpen ? ' open' : ''}`}>›</span>
                  </div>
                </div>
                <div className={`bracket-body${isOpen ? ' open' : ''}`}>
                  <Link href={`/tournament?id=${b.id}`} className="btn btn-outline btn-sm" style={{ marginTop: 8, display: 'inline-block' }}>
                    Open Full Bracket View →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && brackets && brackets.length === 0 && (
        <div className="empty-state">
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z" />
          </svg>
          <p>
            No saved brackets yet. <Link href="/bracket.html">Create one</Link> in the Bracket Generator.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
