// Reachable now that the busy flag that used to serialize every tap is gone
// (the whole point of making picks optimistic) -- two requests for the SAME
// slot can be in flight at once. Scenario: clear Mario (request #1, delayed,
// ultimately fails), then immediately pick Luigi into the same now-empty
// slot (request #2, resolves right away, succeeds). Without the per-slot
// monotonic guard in setPick (useDraftRoom.ts), #1's late failure would roll
// the slot back to its OWN prior value (Mario) once it finally arrives,
// silently clobbering Luigi -- a real, visible corruption, not a
// theoretical one. The guard discards #1's rollback because a newer request
// (#2) has since been issued for that slot.
import { test, expect } from '@playwright/test';
import { mockAuth, mockDraftApis, makeRoom } from './mocks';

test.use({ viewport: { width: 390, height: 844 } });

test('a stale delayed failure does not clobber a newer successful pick for the same slot', async ({ page }) => {
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
      const body = route.request().postDataJSON() as { slot_index: number; character: string | null };
      if (body.character === null) {
        // Request #1: the clear. Delayed and ultimately fails.
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 500, json: { detail: 'stale failure' } });
      } else {
        // Request #2: picking Luigi into the same slot. Resolves immediately.
        await route.fulfill({ json: room });
      }
    },
  });

  await page.goto('/draft/1');

  const marioTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Mario"]') });
  const luigiTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Luigi"]') });
  await expect(marioTile).toHaveClass(/picked/);

  // #1: clear Mario (delayed, will fail ~1500ms from now).
  await marioTile.click();
  await expect(marioTile).not.toHaveClass(/picked/);

  // #2: immediately pick Luigi into the now-empty slot (resolves right away).
  await luigiTile.click();
  await expect(luigiTile).toHaveClass(/picked/);

  // Past #1's delay -- its stale failure has now landed. Luigi must still be
  // the pick; the guard should have discarded #1's rollback rather than
  // letting it restore Mario over Luigi.
  await page.waitForTimeout(1700);
  await expect(luigiTile).toHaveClass(/picked/);
  await expect(marioTile).not.toHaveClass(/picked/);
});
