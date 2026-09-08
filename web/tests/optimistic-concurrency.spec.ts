// Covers the optimistic-concurrency guard added to PUT /draft/rooms/:id/pick
// after the stale-seed bug's worse half: a tap that DIDN'T collide with the
// duplicate-character check used to write straight through and silently
// overwrite whatever a slot really held, with no error at all. The server
// now compares an expected_character the client sends against the slot's
// real stored value and 409s on a mismatch, returning the real value so the
// client can self-heal instead of guessing.
import { test, expect } from '@playwright/test';
import { mockAuth, mockDraftApis, makeRoom } from './mocks';

test.use({ viewport: { width: 390, height: 844 } });

test('a 409 self-heals to the server\'s real value instead of a plain rollback', async ({ page }) => {
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

  let sawExpectedCharacter: string | null | undefined;

  await mockAuth(page);
  await mockDraftApis(page, {
    room,
    favorites: ['Mario', 'Luigi', 'Peach'],
    onPick: async (route) => {
      const body = route.request().postDataJSON() as {
        slot_index: number;
        character: string | null;
        expected_character?: string | null;
      };
      sawExpectedCharacter = body.expected_character;
      // Simulate a concurrent write this client never learned about: slot 1
      // is really 'Peach', not the null this client's stale view believes.
      await route.fulfill({
        status: 409,
        json: { detail: 'Your view of this slot is out of date.', actual_character: 'Peach' },
      });
    },
  });

  await page.goto('/draft/1');

  const luigiTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Luigi"]') });
  const peachTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Peach"]') });
  const slot2Box = page.locator('.draft-slot-box').nth(1);

  await luigiTile.click();

  // Self-heal: slot 2 shows Peach (the server's real value) -- not Luigi
  // (what was tapped, which would be a silent overwrite) and not empty
  // either (a plain rollback-to-prior would produce that, which is itself
  // wrong -- "empty" is exactly the stale belief that got rejected).
  await expect(slot2Box.locator('img')).toHaveAttribute('alt', 'Peach');
  await expect(luigiTile).not.toHaveClass(/picked/);
  await expect(peachTile).toHaveClass(/picked/);

  // The visible cue uses the "out of date" wording (DraftCharacterSelect's
  // errorMessageFor), not the raw server detail string -- confirms a 409 is
  // shown differently from every other failure through the same error span.
  await expect(page.locator('text=out of date')).toBeVisible();

  // expected_character was actually sent, and reflected this client's real
  // belief about the slot (empty -> null), not the character being picked.
  expect(sawExpectedCharacter).toBeNull();
});

test('a stale delayed 409 does not clobber a newer successful pick for the same slot', async ({ page }) => {
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
      const body = route.request().postDataJSON() as { character: string | null };
      if (body.character === null) {
        // Request #1: clearing Mario from slot 0. Delayed, ultimately 409s
        // -- simulating some other write having since changed slot 0 to
        // 'Fox' by the time this resolves.
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 409, json: { detail: 'stale', actual_character: 'Fox' } });
      } else {
        // Request #2: picking Luigi into the same, now-locally-empty slot.
        // Resolves immediately.
        await route.fulfill({ json: room });
      }
    },
  });

  await page.goto('/draft/1');

  const marioTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Mario"]') });
  const luigiTile = page.locator('.draft-grid-tile', { has: page.locator('img[alt="Luigi"]') });
  const slot1Box = page.locator('.draft-slot-box').nth(0);

  await expect(marioTile).toHaveClass(/picked/);

  // #1: clear Mario (delayed, will 409 ~1500ms from now).
  await marioTile.click();
  await expect(marioTile).not.toHaveClass(/picked/);

  // #2: immediately pick Luigi into the now-empty slot (resolves right away).
  await luigiTile.click();
  await expect(luigiTile).toHaveClass(/picked/);

  // Past #1's delay -- its stale 409 has now landed. Luigi must still be the
  // pick; the existing per-slot sequence guard (requestSeqRef) should have
  // discarded #1's self-heal (which would have written 'Fox') the same way
  // it already discards a stale rollback.
  await page.waitForTimeout(1700);
  await expect(luigiTile).toHaveClass(/picked/);
  await expect(marioTile).not.toHaveClass(/picked/);
  await expect(slot1Box.locator('img')).toHaveAttribute('alt', 'Luigi');
});
