'use client';

// Test-only harness -- NOT a real feature route. Exists solely so
// web/tests/draft-status-gate.spec.ts can assert on useDraftRoom's
// composedRoom output directly.
//
// Why this exists instead of testing through the real /draft/[roomId] page:
// page.tsx only ever mounts DraftCharacterSelect while
// room.status === 'picking' -- the instant a broadcast flips status to
// 'revealed'/'live', it unmounts in the same render pass in favor of
// DraftWaiting/DraftReveal, neither of which displays the picked character's
// name (DraftWaiting only shows a lock icon; DraftReveal needs bracket data +
// GSAP + a Flip-transition timer, unrelated machinery for what this test
// actually checks). So there's no way to observe "does composedRoom hand
// picks[myKey] authority back to the WS broadcast once picking ends" through
// real page rendering -- the one component that would show it is gone by
// then. This harness renders useDraftRoom's output as plain text instead.
import { notFound, useSearchParams } from 'next/navigation';
import { useDraftRoom } from '../../lib/useDraftRoom';

export default function DraftRoomStateHarness() {
  // This is a real App Router route (/dev-test/draft-room-state) -- it gets
  // built and would be publicly reachable on Vercel like any other page.
  // 404 it there; still fully usable under `next dev`/Playwright's own
  // webServer, which is the only place it's meant to run.
  if (process.env.NODE_ENV === 'production') notFound();

  const params = useSearchParams();
  const roomId = Number(params.get('roomId') ?? '1');
  const { room, myId } = useDraftRoom(roomId);

  if (!room || myId == null) return <pre data-testid="room-state">loading</pre>;

  return <pre data-testid="room-state">{JSON.stringify({ status: room.status, myPicks: room.picks[String(myId)] })}</pre>;
}
