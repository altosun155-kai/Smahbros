'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '../../lib/api';
import { useDraftRoom } from '../../lib/useDraftRoom';
import Button from '../../components/Button';
import PageContainer from '../../components/PageContainer';
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
  const { room, error, notJoined, refetch, myId, setPick } = useDraftRoom(roomId);
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
      <PageContainer style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ marginBottom: 16 }}>You haven&apos;t joined this draft yet.</p>
        <Button disabled={joining} onClick={join}>
          {joining ? 'Joining…' : 'Join this draft'}
        </Button>
        {joinError && <div style={{ color: '#e74c3c', fontSize: '0.85rem', marginTop: 12 }}>{joinError}</div>}
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: '#e74c3c' }}>{error}</p>
      </PageContainer>
    );
  }

  if (!room) {
    return (
      <PageContainer style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </PageContainer>
    );
  }

  if (room.status === 'closed') {
    return (
      <PageContainer style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <p>This draft was closed by the host.</p>
      </PageContainer>
    );
  }

  const fullyLocked = isFullyLocked(myId != null ? room.picks[String(myId)] : undefined, room.chars_per_player);

  let body;
  if (room.status === 'lobby') {
    body = <DraftLobby room={room} myId={myId} onChanged={refetch} />;
  } else if (room.status === 'picking' && !fullyLocked && myId != null) {
    body = <DraftCharacterSelect room={room} myId={myId} onChanged={refetch} setPick={setPick} />;
  } else if (room.status === 'live') {
    body = <DraftReveal room={room} />;
  } else {
    body = <DraftWaiting room={room} />;
  }

  return <PageContainer>{body}</PageContainer>;
}
