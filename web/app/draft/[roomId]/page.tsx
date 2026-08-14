'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '../../lib/api';
import { useDraftRoom } from '../../lib/useDraftRoom';
import DraftLobby from './DraftLobby';
import DraftCharacterSelect from './DraftCharacterSelect';
import DraftWaiting from './DraftWaiting';
import DraftReveal from './DraftReveal';

function isFullyLocked(picks: { locked: boolean }[] | undefined, charsPerPlayer: number): boolean {
  if (!picks) return false;
  return picks.length === charsPerPlayer && picks.every((p) => p.locked);
}

export default function DraftRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = Number(params.roomId);
  const { room, error, notJoined, refetch, myId } = useDraftRoom(roomId);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      await apiPost(`/draft/rooms/${roomId}/join`);
      await refetch();
    } catch (e) {
      setJoinError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  if (notJoined) {
    return (
      <main className="page-container" style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ marginBottom: 16 }}>You haven&apos;t joined this draft yet.</p>
        <button type="button" className="btn btn-primary" disabled={joining} onClick={join}>
          {joining ? 'Joining…' : 'Join this draft'}
        </button>
        {joinError && <div style={{ color: '#e74c3c', fontSize: '0.85rem', marginTop: 12 }}>{joinError}</div>}
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-container" style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: '#e74c3c' }}>{error}</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="page-container" style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </main>
    );
  }

  if (room.status === 'closed') {
    return (
      <main className="page-container" style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p>This draft was closed by the host.</p>
      </main>
    );
  }

  const fullyLocked = isFullyLocked(myId != null ? room.picks[String(myId)] : undefined, room.chars_per_player);

  let body;
  if (room.status === 'lobby') {
    body = <DraftLobby room={room} myId={myId} onChanged={refetch} />;
  } else if (room.status === 'picking' && !fullyLocked && myId != null) {
    body = <DraftCharacterSelect room={room} myId={myId} onChanged={refetch} />;
  } else if (room.status === 'live') {
    body = <DraftReveal room={room} />;
  } else {
    body = <DraftWaiting room={room} />;
  }

  return <main className="page-container">{body}</main>;
}
