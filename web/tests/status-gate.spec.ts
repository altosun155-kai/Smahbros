// Tests composedRoom's status gate in useDraftRoom.ts directly, via the
// web/app/dev-test/draft-room-state harness -- not through the real
// /draft/[roomId] page. Reason: page.tsx only mounts DraftCharacterSelect
// while room.status === 'picking'; the instant a broadcast flips status to
// 'revealed'/'live' it unmounts in the same render in favor of
// DraftWaiting/DraftReveal, neither of which displays the picked character's
// name. There's no way to observe "does picks[myKey] hand authority back to
// the WS broadcast once picking ends" through real page rendering, since the
// one component that would show it is gone by the time it matters -- so this
// exercises the hook directly instead (see the harness file for the same
// reasoning at more length).
import { test, expect } from '@playwright/test';
import { mockAuth, mockDraftApis, makeRoom } from './mocks';

test('once status leaves "picking", the WS broadcast becomes authoritative for my own picks', async ({ page }) => {
  const room = makeRoom({
    id: 1,
    chars_per_player: 4,
    status: 'picking',
    picksOverride: {
      '1': [
        { slot_index: 0, character: 'Mario', locked: true },
        { slot_index: 1, character: null, locked: false },
        { slot_index: 2, character: null, locked: false },
        { slot_index: 3, character: null, locked: false },
      ],
    },
  });

  await mockAuth(page);
  const ws = await mockDraftApis(page, { room });

  await page.goto('/dev-test/draft-room-state?roomId=1');

  const state = page.getByTestId('room-state');
  await expect(state).toContainText('"status":"picking"');
  await expect(state).toContainText('"character":"Mario"');

  // The reveal broadcast: status flips, and the server now builds picks
  // revealed for everyone (routers/draft.py's draft_room_to_dict: reveal is
  // true once room.status is 'revealed'/'live', regardless of viewer). Uses
  // a DIFFERENT character than local truth (Bowser, not Mario) specifically
  // so the assertion is unambiguous -- if the gate failed to hand authority
  // back, this would still read Mario (the stale local value) instead.
  ws.pushMessage({
    ...room,
    status: 'live',
    picks: {
      ...room.picks,
      '1': [
        { slot_index: 0, character: 'Bowser', locked: true },
        { slot_index: 1, character: null, locked: false },
        { slot_index: 2, character: null, locked: false },
        { slot_index: 3, character: null, locked: false },
      ],
    },
  });

  await expect(state).toContainText('"status":"live"');
  await expect(state).toContainText('"character":"Bowser"');
  await expect(state).not.toContainText('"character":"Mario"');
});
