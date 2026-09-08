# Survivor-count strip on the live bracket view

## Context

During a free-pool tournament, each player can hold several bracket entries
(one per character, `chars_per_player` > 1). Partway through, the group
decides by eye whether to keep playing, by counting how many of each
player's characters are still alive on the bracket. This makes that count a
first-class, always-visible, always-accurate piece of UI instead of an
eyeballed one — nothing more. The app states the numbers; the group still
decides what to do with them.

## Enumeration: every place a bracket is rendered

| Location | What it is | Strip? |
|---|---|---|
| `web/app/tournament/page.tsx` | The real live, multi-device bracket view. Fetches `GET /brackets/{id}` into `data`; a WS on `/ws/tournament/{id}` triggers a refetch on push, plus a 5s poll fallback. This is where matches actually get scored, for both manually-built and draft-originated brackets. | **Yes — build here first.** |
| `web/app/bracket/page.tsx` | The manual builder: full bracket render (connector lines, VS-modal scoring, round winners) but single-user/local state, no WS, no fetch-by-id. A real scoring surface, just not multi-device-live. | **Yes — second, after tournament verified.** |
| `web/app/draft/[roomId]/DraftReveal.tsx` → `DraftBracketPreview.tsx` | **Not a live or scoring view, contrary to this task's original framing.** Fetches `bracket_data` exactly once (its own `BracketSummary` type doesn't even declare `round_winners`) to power a one-time card-flip reveal animation, then renders that same frozen snapshot indefinitely — no WS, no poll, no re-fetch while open. Confirmed no results are ever shown or updated here; actual play happens by clicking "Open Bracket," which lands on `/tournament?id=...` above. | **No** — nothing has been played yet at this screen; a strip would just show every player at max, and there's no live mechanism to ride. Resolved with you: leave untouched. |
| `web/app/my-brackets/page.tsx` | A list of the user's brackets. `GET /brackets` (used here) doesn't even return `bracket_data` — this page never renders a bracket, only links out to `/tournament?id=`. | **No** — not a bracket display. |

## Data model (confirmed)

Elimination is derived, not stored — no `BracketEntry` model, no status
column. `Bracket.bracket_data` (round-1 `{a, b}` pairs of `"player —
character"` labels, or the literal `"BYE"`) and `Bracket.round_winners`
(`{"r{round}_m{match}": winningLabel}`) are the only source of truth, and
both are already present, unfetched-for-nothing, everywhere the strip goes:
`tournament/page.tsx`'s `data` object has them as real fields (`BracketData`
interface), and `bracket/page.tsx` has `currentBracket`/`roundWinners`/
`charsPerPlayer` local state carrying the same information (in `Entry`-object
form, convertible to label form via its existing `entryLabel()` helper).

**Bye handling — checked separately on each path, not assumed to match, and
it doesn't.** `routers/draft.py::_build_free_pool_bracket` really does
pre-resolve a bye's winner into `round_winners` at creation
(`round_winners[f"r0_m{m}"] = <non-bye label>`, confirmed by reading it) —
but that turns out to be a backend-only convenience for `_compute_round_
participants`/`_award_placements`, which have no other way to skip a bye;
`tournament/page.tsx`'s own render-path `getWinner()` never actually reads
that pre-resolution either — it independently short-circuits on
`a.toUpperCase() === 'BYE'` before ever consulting `round_winners`.

**The manual path does not pre-resolve byes at all — confirmed by reading
`bracket/page.tsx::generateBracket()`, which calls `setRoundWinners({})` (a
genuinely empty object) right after building pairs.** Its render path
(`getWinnerOf`) also resolves a bye purely by checking
`entry.character.toUpperCase() === 'BYE'` on the pair, never touching
`round_winners` for that match. So a naive "read the winner straight off
`round_winners`" implementation — my first draft — is correct for
tournament/page.tsx (where the pre-resolution happens to also exist) but
silently wrong for bracket/page.tsx: a bye match's key is simply absent from
`round_winners`, so the bye-advanced real entry would never be carried into
the next round's participant list, and its eventual real loss later in the
tournament would never register (that entry stays "alive" forever, exactly
the failure mode you flagged) — a bug specific to non-power-of-two entry
counts, invisible in one page's testing and real in the other's.

**Fix: resolve a bye match's winner the same way both pages' own render
paths already do — a direct label check, before ever consulting
`round_winners` — rather than trusting `round_winners` to carry it.** This
is a small, self-contained rule (`isBye(label)`) restated once in the shared
module, not a copy of either page's `getWinner`/`getWinnerOf`, and it makes
`computeSurvivors` correct on both paths uniformly instead of relying on a
convention that only actually holds on one of them. For every other match
(both sides real entries), `round_winners[f"r{ri}_m{mi}"]` remains the
authoritative winner exactly as before: a label present in a resolved
match's pair but not equal to the winner is eliminated; a label never named
as a loser anywhere is a survivor (covers unplayed matches and bye-advanced
entries identically, per spec).

**`entryLabel()` output, confirmed for `bracket/page.tsx`'s call site:** a
bye slot is always a real `Entry` object (`BYE_ENTRY = {player: 'SYSTEM',
character: 'BYE'}`, padded in by `buildBracketPairs` — never a bare `null`
slot in `currentBracket`'s `Pair` tuples), and `entryLabel()` special-cases
it to the bare string `'BYE'` (matching the backend's convention exactly,
not `'SYSTEM — BYE'`). A genuinely empty slot, if one ever reached this
function, would produce `''` (empty string) — not reachable today given
`Pair`'s non-nullable typing, but `isRealEntry`'s `!!label` check already
treats an empty string as not-real regardless, so no separate handling is
needed for it.

Self-matches need no special-casing: a self-match is just two labels sharing
the same player prefix (`"kai — Fox"` vs `"kai — Falco"`). `round_winners`
still names exactly one of the two as the winner, so the label-level rule
above eliminates the loser and keeps the winner correctly, with zero
awareness that they're the same real player. This is a different layer from
`record_match`'s `winner.id == loser.id` Elo/no-Elo distinction
(`routers/matches.py`) — unrelated, untouched.

**Players vs. label-player matching (checked against real data, not
assumed).** On both build paths, every entry's player prefix is guaranteed
to come from the same `players` list, not independently typed:
- Draft path (`routers/draft.py::_create_draft_brackets_and_go_live`):
  `players=usernames` and every label's player half both come from the same
  `users_by_id[...].username` lookup at creation time — byte-identical by
  construction.
- Manual path (`bracket/page.tsx::buildEntryGrid`): every `Entry.player` is
  pushed directly from the `players` array (`players.forEach(p => next.push(
  {player: p, ...}))`) — never independently typed, and nothing later
  rewrites `entry.player`.

One real, reachable exception, found while checking this: on
`bracket/page.tsx`, the `playersText` textarea stays editable after a
bracket is generated — nothing stops a host from editing the player list
post-generation without regenerating, which would desync `players` (always
recomputed live from `playersText`) from the frozen bracket's entries. On
`tournament/page.tsx` this can't happen (`players` comes from the fetched
`Bracket` row itself, same source as the labels).

Given that, `computeSurvivors` **fails loudly on a mismatch — no silent
`.filter(Boolean)`, no defensive fallback** — and `SurvivorStrip` catches
that specific failure and renders an explanatory, actionable message in the
strip's own place, not a crash: **"Player list has changed since this
bracket was generated — regenerate the bracket to see survivor counts."**
The underlying mismatch (which label, which players list) is
`console.error`'d alongside it, so a genuine key-format bug stays
diagnosable instead of looking identical to someone editing a textarea. The
rest of the page (matches, scoring, connectors) is unaffected either way —
this failure is scoped to the strip.

## Implementation

**1. `web/app/lib/bracketSurvivors.ts`** (new, pure, no React) — the one
shared implementation both pages call, with a caller-shape-agnostic
signature (raw fields, not a page-specific response object):

```ts
export interface PlayerSurvival {
  player: string;
  alive: number;
  total: number;
  aliveChars: string[]; // still-alive characters, bracket order
}

// Extracted from tournament/page.tsx's existing local parseLabel, verbatim
// behavior (null on anything without ' — ', including 'BYE' -- tournament/
// page.tsx's other call sites (swap-mode click, .mine class check, the
// match-entry render) depend on that exact null-for-BYE contract, so this
// keeps returning null on failure rather than throwing here -- throwing
// belongs to computeSurvivors, which knows a label reaching it is already
// guaranteed real (non-bye, non-TBD) by isRealEntry and so a null return
// here means genuinely malformed data, not a legitimate BYE case.
export function parseLabel(label: string | null | undefined): { player: string; character: string } | null {
  if (!label) return null;
  const idx = label.indexOf(' — ');
  if (idx === -1) return null;
  return { player: label.slice(0, idx), character: label.slice(idx + 3) };
}

function isBye(label: string | null | undefined): boolean {
  return !!label && label.toUpperCase() === 'BYE';
}

function isRealEntry(label: string | null | undefined): label is string {
  // Single definition of "not a real entry" -- BYE checked
  // case-insensitively (matches both pages' existing bye checks), TBD exact
  // (a client-synthesized placeholder, always this exact casing, never
  // sourced from stored data) -- one helper instead of differently-cased
  // inline checks drifting apart.
  return !!label && label !== 'TBD' && !isBye(label);
}

// A bye's winner is resolved the same way BOTH pages' own render paths
// already do it -- a direct label check, before ever consulting
// round_winners -- rather than trusting round_winners to carry it. Checked,
// not assumed: routers/draft.py pre-resolves a bye into round_winners at
// creation, but bracket/page.tsx's generateBracket() calls
// setRoundWinners({}) and never writes a bye's winner there at all, relying
// entirely on this same direct-check rule in its own getWinnerOf. Reading
// round_winners for a bye match would be correct on one path and silently
// wrong on the other, so this checks the label directly on both.
function resolveMatchWinner(a: string | null, b: string | null, key: string, roundWinners: Record<string, string>): string | null {
  if (isBye(a) && isBye(b)) return null; // unreachable on both current paths; no winner rather than throwing here
  if (isBye(a)) return isRealEntry(b) ? b : null;
  if (isBye(b)) return isRealEntry(a) ? a : null;
  if (!isRealEntry(a) || !isRealEntry(b)) return null; // one or both sides not yet populated
  return roundWinners[key] || null;
}

export function computeSurvivors(
  bracketData: { a: string | null; b: string | null }[],
  roundWinners: Record<string, string>,
  players: string[],
): PlayerSurvival[] {
  let round: (string | null)[][] = bracketData.map((p) => [p.a, p.b]);
  const eliminated = new Set<string>();
  const entries = new Set<string>();
  round.forEach(([a, b]) => {
    if (isRealEntry(a)) entries.add(a);
    if (isRealEntry(b)) entries.add(b);
  });

  let ri = 0;
  while (round.length > 0) {
    const winners: (string | null)[] = round.map(([a, b], mi) => resolveMatchWinner(a, b, `r${ri}_m${mi}`, roundWinners));
    round.forEach(([a, b], mi) => {
      const winner = winners[mi];
      if (!winner) return;
      [a, b].forEach((label) => {
        if (isRealEntry(label) && label !== winner) eliminated.add(label);
      });
    });
    if (round.length === 1) break;
    const next: (string | null)[][] = [];
    for (let mi = 0; mi < winners.length; mi += 2) next.push([winners[mi], winners[mi + 1]]);
    round = next;
    ri++;
  }

  const byPlayer = new Map<string, PlayerSurvival>();
  players.forEach((p) => byPlayer.set(p, { player: p, alive: 0, total: 0, aliveChars: [] }));

  entries.forEach((label) => {
    const parsed = parseLabel(label);
    // isRealEntry already excluded BYE/TBD/empty above, so a null here means
    // a genuinely malformed label -- fail loudly rather than dropping it.
    if (!parsed) throw new Error(`computeSurvivors: entry label has no ' — ' separator: "${label}"`);
    const row = byPlayer.get(parsed.player);
    if (!row) {
      throw new Error(
        `computeSurvivors: entry "${label}" belongs to player "${parsed.player}", ` +
          `not present in players list [${players.join(', ')}]`
      );
    }
    row.total++;
    if (!eliminated.has(label)) {
      row.alive++;
      row.aliveChars.push(parsed.character);
    }
  });

  return players.map((p) => byPlayer.get(p)!);
}
```

`tournament/page.tsx` drops its own local `parseLabel` and imports this one
instead — identical behavior (same null-on-failure contract), so its
existing call sites (swap-mode label parsing, the `.mine`-class check, the
match-entry render) are unaffected.

`bracket/page.tsx` also switches to the shared import rather than keeping
its own third copy — checked, not assumed, that the two are behaviorally
identical first: its local `parseLabel(label: string)` (line 435) omits the
shared version's `if (!label) return null` guard, but every call site there
(`recordMatchResult`, the VS-modal winner/loser parsing) only ever passes a
real non-empty string, and even if it were called with `''`,
`''.indexOf(' — ')` is `-1` either way — same `null` result through the
guard-less path. Same `indexOf`/`slice` logic otherwise. Since this file is
already being edited for the strip itself, and a second copy sitting in the
exact file the shared module is wired into is precisely the drift this
extraction exists to prevent, its local definition is deleted and its
existing call sites (`recordMatchResult`, `setWinner`'s winner/loser
parsing) switch to the shared import — a one-line change with a verified-
identical contract, not a render-path behavior change.

Note on the sum-of-alive invariant you raised: `alive + (entries eliminated
for that player) === total` for every player by construction (the partition
can't drift, whether or not `eliminated` itself is computed correctly) — so
it's not a real test of correctness on its own. The actual check is the
manual cross-reference against the entries visibly still standing on the
rendered bracket, done live at two points mid-tournament, per Verification
below — that's the one that would actually catch a bug like the bye one
just found.

**2. `web/app/components/SurvivorStrip.tsx`** (new) — owns calling
`computeSurvivors` and catching its throw. Both early-return paths
(`charsPerPlayer <= 1` and the catch block) sit after the one hook this
component needs, not before it:

```tsx
export default function SurvivorStrip({
  bracketData, roundWinners, players, charsPerPlayer,
}: {
  bracketData: { a: string | null; b: string | null }[];
  roundWinners: Record<string, string>;
  players: string[];
  charsPerPlayer: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (charsPerPlayer <= 1) return null;

  let survivors: PlayerSurvival[];
  try {
    survivors = computeSurvivors(bracketData, roundWinners, players);
  } catch (e) {
    console.error('[SurvivorStrip] player/label mismatch', e);
    return (
      <div className="survivor-strip survivor-strip-error">
        Player list has changed since this bracket was generated —
        regenerate the bracket to see survivor counts.
      </div>
    );
  }

  // ...pills: name + "alive/total", tap toggles expanded (via setExpanded);
  // expanded pill shows charHeadUrl(char) icons for aliveChars only, per
  // spec (an eliminated character's icon just isn't shown -- no separate
  // "eliminated" visual asked for).
}
```

**3. Wiring — `tournament/page.tsx`, first.** Insert
`<SurvivorStrip bracketData={data.bracket_data} roundWinners={data.round_winners || {}} players={data.players} charsPerPlayer={data.chars_per_player || 1} />`
right after the page-header block (after line ~963, before the
`LineupPhase`/bracket-rounds branch), gated on `hasBracket` (component
itself further gates on `charsPerPlayer <= 1`). Rides the exact same
`data` state the WS-triggered refetch and 5s poll already update — no new
subscription.

**4. Wiring — `bracket/page.tsx`, second, once tournament/page.tsx is
verified.** Insert
`<SurvivorStrip bracketData={currentBracket.map(([a, b]) => ({ a: entryLabel(a), b: entryLabel(b) }))} roundWinners={roundWinners} players={players} charsPerPlayer={charsPerPlayer} />`
gated on `bracketOutputVisible`. "Live" here means whatever this page
already re-renders on (local `roundWinners` state updates from scoring) —
no WS to ride, none added.

**5. CSS.** A small `.survivor-strip` block added to each page's existing
CSS file (`tournament.css`, `bracket.css`) — horizontally-scrollable pill
row, same `overflow-x: auto` convention as `.bracket-rounds`, consistent
with the existing `.live-badge`/`.ended-badge` visual language already on
these pages. `.survivor-strip-error` styled as a clear but low-key notice,
not an alarming red error banner — it's an expected, self-resolving state
(regenerate the bracket), not a crash.

## Explicitly not doing

- No new backend endpoint, no new DB column, no new WS message type.
- No "nothing contested left" detection, no end-tournament prompting.
- No persistence of expand/collapse state or historical survivor counts.
- No change to `record_match`'s self-match Elo handling, and no change to
  either page's existing `computeRounds`/`getWinner(Of)` render-path
  functions — `computeSurvivors` never calls into either. The one shared
  extraction is `parseLabel`, a pure 3-line function with an unchanged
  contract, not the round-walk itself.
- No live-refresh mechanism added to the draft room screen — left as-is per
  your answer.

## Verification

Per file, in this order — tournament/page.tsx fully verified before
touching bracket/page.tsx.

1. Scratch backend (`smash_test_survivors.db`, port 8850) + scratch
   frontend (port 8851), per the established local-verification convention.
2. **`tournament/page.tsx`:** build/reach a free-pool bracket
   (`chars_per_player: 4`) with one deliberate self-match (two of one
   player's entries meeting each other) via `/tournament?id=...`:
   - Strip renders immediately; per-player alive/total correct.
   - Score the self-match: advancing entry's character stays in that
     player's alive list, the losing one drops, that player's own Elo/stats
     unaffected (cross-check against `routers/matches.py`'s existing
     self-match no-op).
   - Score one player down to zero: their pill stays, reads "0/4", not
     hidden.
   - Tap a pill: expansion shows head icons for exactly the still-alive
     characters.
   - Manually cross-check alive counts against the entries visibly still
     standing on the rendered bracket, at at least two different points
     mid-tournament — the real test, not the structural sum-of-alive
     identity (see note above).
   - Second browser context on the same URL: score a match in the first,
     confirm the second updates within 5s (or faster via WS) with no manual
     refresh.
   - `chars_per_player: 1` bracket: confirm the strip does not render.
   - 390×844 mobile viewport: confirm usable (scroll/wrap, tap targets).
   - **Non-power-of-two entry count (e.g. a 6-entry or 12-entry bracket, at
     least one real bye in round 1):** score the bye-advanced entry's next
     real match and confirm it correctly drops out of that player's alive
     count — this is the exact scenario the bye-resolution fix above exists
     for; a clean power-of-two bracket alone would not catch a regression
     here.
3. **`bracket/page.tsx`:** generate a manual `chars_per_player: 4` bracket,
   repeat the self-match/zero-survivor/expand/mobile/bye checks above (no
   multi-device check here — this page has no live sync; the bye check
   matters even more here since this path never pre-resolves one into
   `round_winners` at all). Then specifically reproduce the fail-loud path:
   generate the bracket, edit the player-list textarea afterward without
   regenerating, confirm the strip shows the "regenerate the bracket"
   message (not a crash, not silent zeros) while the rest of the page —
   matches, VS modal scoring, connector lines — keeps working; confirm the
   mismatch is `console.error`'d.
4. `cd web && npx tsc --noEmit -p tsconfig.json` — clean.
5. Teardown per convention: kill scratch backend/frontend by exact PID,
   delete the scratch DB, `git checkout --` any incidental `__pycache__`/
   `tsconfig.tsbuildinfo` changes.
6. Nothing committed or pushed without explicit go-ahead, per standing
   convention.
