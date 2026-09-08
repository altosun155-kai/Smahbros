// bracketSurvivors.ts — computes, per player, how many of their bracket
// entries are still alive in a free-pool tournament ("survivor counts"),
// for the strip shown on tournament/page.tsx and bracket/page.tsx. Pure, no
// React -- SurvivorStrip.tsx owns rendering and the fail-loud catch.
//
// Elimination is derived, not stored -- there's no BracketEntry model or
// status column, only Bracket.bracket_data (round-1 {a,b} pairs of
// "player — character" labels, or the literal "BYE") and
// Bracket.round_winners ({"r{round}_m{match}": winningLabel}). A label
// present in a resolved match's pair but not equal to that match's winner
// is eliminated; a label never named as a loser anywhere is a survivor --
// this covers unplayed matches and bye-advanced entries identically, per
// spec, with no separate handling needed.
//
// Self-matches (two labels sharing the same player prefix, from a
// free-pool draft) need no special-casing here: round_winners still names
// exactly one of the two labels as the winner, so the label-level rule
// above eliminates the loser and keeps the winner correctly, with zero
// awareness that they belong to the same real player. That's a different
// layer from routers/matches.py's record_match winner.id == loser.id
// Elo/no-Elo distinction -- unrelated, untouched here.

export interface PlayerSurvival {
  player: string;
  alive: number;
  total: number;
  aliveChars: string[]; // still-alive characters, bracket order
}

// Extracted from tournament/page.tsx's local parseLabel, verbatim behavior
// (null on anything without ' — ', including 'BYE') -- tournament/page.tsx's
// other call sites (swap-mode label parsing, the .mine-class check, the
// match-entry render) depend on that exact null-for-BYE contract, so this
// keeps returning null on failure rather than throwing here. Throwing
// belongs to computeSurvivors below, which only ever calls this on a label
// isRealEntry has already guaranteed is real (non-bye, non-TBD) -- so a
// null return there means genuinely malformed data, not a legitimate BYE
// case.
//
// bracket/page.tsx's own local parseLabel(label: string) was checked
// against this one and found behaviorally identical (it just omits the
// `if (!label) return null` guard -- its call sites only ever pass a real
// non-empty string, and even '' falls through indexOf to the same -1/null
// result either way) -- so it was deleted in favor of this shared version
// rather than left as a third copy, alongside the backend's own
// routers/brackets.py::_parse_label.
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

// A bye's winner is resolved the same way both pages' own render paths
// already do it -- a direct label check, before ever consulting
// round_winners -- rather than trusting round_winners to carry it. Checked,
// not assumed: routers/draft.py::_build_free_pool_bracket pre-resolves a
// bye into round_winners at creation, but bracket/page.tsx's
// generateBracket() calls setRoundWinners({}) and never writes a bye's
// winner there at all, relying entirely on this same direct-check rule in
// its own getWinnerOf. Reading round_winners for a bye match would be
// correct on the draft/tournament path and silently wrong on the manual
// path (the bye-advanced entry would never be carried into the next
// round's participants, so its eventual real loss later on would never
// register), so this checks the label directly on both instead.
function resolveMatchWinner(
  a: string | null,
  b: string | null,
  key: string,
  roundWinners: Record<string, string>
): string | null {
  if (isBye(a) && isBye(b)) return null; // unreachable on both current paths; no winner rather than throwing here
  if (isBye(a)) return isRealEntry(b) ? b : null;
  if (isBye(b)) return isRealEntry(a) ? a : null;
  if (!isRealEntry(a) || !isRealEntry(b)) return null; // one or both sides not yet populated
  return roundWinners[key] || null;
}

export function computeSurvivors(
  bracketData: { a: string | null; b: string | null }[],
  roundWinners: Record<string, string>,
  players: string[]
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
    // isRealEntry already excluded BYE/TBD/empty above, so a null here
    // means a genuinely malformed label -- fail loudly rather than
    // dropping it.
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
