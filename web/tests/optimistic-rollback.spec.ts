// Nothing else in this test suite exercises setPick's rollback branch -- every
// other test's mocked PUT succeeds. This is the one that makes it fail and
// checks the optimistic update actually reverses.
//
// Note on "abort": a literal route.abort() makes fetch() throw, which lands
// in apiFetch's outer catch (api.ts) -- that path assumes a Render cold
// start and retries after a real 25-second wait, up to 3 attempts, before
// finally throwing. That's real, intentional behavior for the live app, but
// it'd make this test take 50+ seconds to reach the rejection setPick
// actually reacts to. Using a fulfilled non-2xx response instead reaches the
// exact same catch block in setPick (useDraftRoom.ts) without waiting on
// unrelated retry/backoff machinery that isn't what's under test here.
import { test, expect } from '@playwright/test';
import { mockAuth, mockDraftApis, makeRoom } from './mocks';

test.use({ viewport: { width: 390, height: 844 } });

test('a failed PUT rolls the optimistic clear back to the prior character', async ({ page }) => {
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
  await mockDraftApis(page, {
    room,
    favorites: ['Mario', 'Luigi'],
    onPick: async (route) => {
      // A short delay, not zero -- fulfilling instantly raced Playwright's
      // own click-then-assert enough that the rollback sometimes landed
      // before the "optimistic" assertion below ever got to observe the
      // cleared state. This is a test-timing fix, not a product one: the
      // real failure paths (a real 500, a real network drop) are never
      // instant either.
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({ status: 500, json: { detail: 'simulated failure' } });
    },
  });

  await page.goto('/draft/1');

  const marioTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Mario"]') });
  await expect(marioTile).toHaveClass(/picked/);

  const marioSlotBox = page.locator('.draft-slot-box', { has: page.locator('img[alt="Mario"]') });
  await marioSlotBox.click();

  // Optimistic: cleared instantly, before the (fast-failing) PUT even
  // settles.
  await expect(marioTile).not.toHaveClass(/picked/);

  // Rolled back once the failure lands -- Playwright's toHaveClass polls,
  // so this is really "eventually true", not a race against a fixed delay.
  await expect(marioTile).toHaveClass(/picked/);
});
