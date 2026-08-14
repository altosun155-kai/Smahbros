'use client';

import { useEffect, useState } from 'react';
import { apiPost, showToast } from '../../lib/api';
import type { DraftRoomState } from '../../lib/useDraftRoom';

export default function DraftLobby({ room, myId, onChanged }: { room: DraftRoomState; myId: number | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const isHost = myId === room.host_id;
  const canStart = isHost && room.players.length >= 2;

  // Computed client-side only (not during SSR) so hydration never has to
  // reconcile a server-rendered empty string against the real location.
  useEffect(() => {
    setShareUrl(window.location.href);
  }, []);

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied!', 'success');
    } catch {
      showToast('Could not copy link', 'error');
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/draft/rooms/${room.id}/start`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/draft/rooms/${room.id}/close`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slots = Array.from({ length: room.num_players });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', padding: '32px 0' }}>
      {isHost && (
        <div className="draft-share-bar">
          <span>Share link with players:</span>
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copyShareLink}>
            Copy
          </button>
        </div>
      )}

      <div className="draft-avatar-grid">
        {slots.map((_, i) => {
          const p = room.players[i];
          return (
            <div key={i} className="draft-avatar-slot">
              {p ? (
                <>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.username} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                  ) : (
                    <div className="draft-avatar-placeholder">{p.username[0]?.toUpperCase()}</div>
                  )}
                  <span>
                    {p.username}
                    {p.id === room.host_id ? ' (host)' : ''}
                  </span>
                </>
              ) : (
                <div className="draft-avatar-empty">Waiting…</div>
              )}
            </div>
          );
        })}
      </div>

      {isHost ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-primary" disabled={!canStart || busy} onClick={start}>
            {busy ? 'Starting…' : 'Start'}
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>Waiting for the host to start…</p>
      )}
      {error && <div style={{ color: '#e74c3c', fontSize: '0.85rem' }}>{error}</div>}
    </div>
  );
}
