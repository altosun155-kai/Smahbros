// The failure this guards against was guaranteed, not rare: routers/draft.py's
// pick_draft_character calls _push() (the masked WS broadcast) BEFORE
// returning the HTTP response body, so the masked push reliably beats the
// PUT response back to the browser on every clear. The old merge logic in
// useDraftRoom.ts used to see that masked null and "helpfully" restore its
// own cached character -- exactly undoing the clear the instant any
// broadcast arrived, regardless of which action caused it. The fix removes
// that substitution entirely: myKey is never sourced from the WS while
// picking (see composedRoom in useDraftRoom.ts). This test proves it by
// firing a masked broadcast into the middle of an artificially slow PUT and
// asserting the cleared character never reappears.
import { test, expect } from '@playwright/test';
import { mockAuth, mockDraftApis, makeRoom } from './mocks';

test.use({ viewport: { width: 390, height: 844 } });

test('a masked WS broadcast during a slow PUT does not restore the cleared character', async ({ page }) => {
  const room = makeRoom({
    id: 1,
    chars_per_player: 4,
    picksOverride: {
      '1': [
        { slot_index: 0, character: 'Mario', locked: false },
        { slot_index: 1, character: null, locked: false },
        { slot_index: 2, character: null, locked: false },
        { slot_index: 3, character: null, locked: false },
      ],
    },
  });

  await mockAuth(page);
  const ws = await mockDraftApis(page, {
    room,
    favorites: ['Mario', 'Luigi'],
    onPick: async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ json: room });
    },
  });

  await page.goto('/draft/1');

  const marioTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Mario"]') });
  await expect(marioTile).toHaveClass(/picked/);

  const marioSlotBox = page.locator('.draft-slot-box', { has: page.locator('img[alt="Mario"]') });
  await marioSlotBox.click();

  // Optimistic: cleared instantly, well before the 1500ms PUT resolves.
  await expect(marioTile).not.toHaveClass(/picked/);

  // Mid-delay: a masked broadcast arrives (character: null for every
  // unlocked slot, exactly what the real server sends during picking,
  // regardless of what actually happened) -- this is the moment the old bug
  // fired. status stays 'picking' throughout.
  await page.waitForTimeout(500);
  ws.pushMessage({ ...room, picks: { ...room.picks, '1': room.picks['1'].map((p) => ({ ...p, character: null })) } });
  await expect(marioTile).not.toHaveClass(/picked/);

  // Past the full delay -- the slow PUT has now resolved (success). Still
  // cleared: the response body is never applied to state at all (setPick
  // only acts on failure), so there's nothing here that could restore it.
  await page.waitForTimeout(1200);
  await expect(marioTile).not.toHaveClass(/picked/);
});
