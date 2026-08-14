'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '../lib/api';

interface ActiveRoom {
  id: number;
  host_username: string;
  player_count: number;
  num_players: number;
}

const CHARS_PER_PLAYER_OPTIONS = [1, 4, 8] as const;

export default function DraftEntryPage() {
  const router = useRouter();
  const [charsPerPlayer, setCharsPerPlayer] = useState<1 | 4 | 8>(1);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rooms = await apiGet<ActiveRoom[]>('/draft/rooms/active');
        if (!cancelled) setActiveRooms(rooms);
      } catch {
        // no dedicated lobby-discovery socket this round -- silently retry on the next poll
      }
    };
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function startDraft() {
    setCreating(true);
    setError(null);
    try {
      const { id } = await apiPost<{ id: number }>('/draft/rooms', { chars_per_player: charsPerPlayer });
      router.push(`/draft/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function joinRoom(id: number) {
    setJoiningId(id);
    setError(null);
    try {
      await apiPost(`/draft/rooms/${id}/join`);
      router.push(`/draft/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setJoiningId(null);
    }
  }

  return (
    <main className="page-container" style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
      <div className="page-header">
        <h1>Draft</h1>
        <p>Pick your characters together, then head into a bracket.</p>
      </div>

      {activeRooms.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {activeRooms.map((r) => (
            <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                <strong>{r.host_username}</strong> started a draft — {r.player_count}/{r.num_players} joined
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={joiningId === r.id}
                onClick={() => joinRoom(r.id)}
              >
                {joiningId === r.id ? 'Joining…' : 'Join'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Characters per player</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {CHARS_PER_PLAYER_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={n === charsPerPlayer ? 'btn btn-primary' : 'btn btn-outline'}
                onClick={() => setCharsPerPlayer(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn-primary" disabled={creating} onClick={startDraft}>
          {creating ? 'Starting…' : 'Start a draft'}
        </button>
        {error && <div style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</div>}
      </div>
    </main>
  );
}
