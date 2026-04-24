// bracket-engine.js — shared bracket generation logic
// Used by bracket.html and tournament.html.
// All functions are globals (no module system needed).

const BYE_ENTRY = { player: 'SYSTEM', character: 'BYE' };

// ── Utilities ─────────────────────────────────────────────────────────────────

function nextPow2(n) {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Seeding ───────────────────────────────────────────────────────────────────
// All seed functions take (entry, statsMap) where:
//   statsMap = { [username]: [{ character, elo, kills, wins, losses, points }] }

function _findStat(entry, statsMap) {
  if (!entry || entry.player === 'SYSTEM') return null;
  return (statsMap[entry.player] || []).find(s => s.character === entry.character) || null;
}

function getSeedElo(entry, statsMap) {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = _findStat(entry, statsMap);
  return s ? (s.elo || 1000) : 1000;
}

function getSeedKills(entry, statsMap) {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = _findStat(entry, statsMap);
  return s ? (s.kills || 0) : 0;
}

function getSeedWinPct(entry, statsMap) {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = _findStat(entry, statsMap);
  if (!s) return 0;
  const total = (s.wins || 0) + (s.losses || 0);
  return total >= 3 ? (s.wins || 0) / total : 0;
}

function getSeedPoints(entry, statsMap) {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = _findStat(entry, statsMap);
  return s ? (s.points || 0) : 0;
}

function getSeedByMode(entry, statsMap, seedMode) {
  if (seedMode === 'kills')   return getSeedKills(entry, statsMap);
  if (seedMode === 'winpct')  return getSeedWinPct(entry, statsMap);
  if (seedMode === 'elo')     return getSeedElo(entry, statsMap);
  return getSeedPoints(entry, statsMap);
}

// ── Standard bracket seeding ──────────────────────────────────────────────────

// Standard single-elimination seeding sequence for a bracket of size n (power of 2).
// Recursively folds so top seeds are kept apart until the final rounds.
// Example: _seedSeq(8) → [1, 8, 4, 5, 2, 7, 3, 6]
function _seedSeq(n) {
  if (n === 1) return [1];
  const half = _seedSeq(n / 2);
  const result = [];
  for (const s of half) result.push(s, n + 1 - s);
  return result;
}

// Pair a ranked (descending score) array of entries using the standard seeding sequence.
// Any position in the sequence beyond ranked.length receives BYE — so the highest seeds
// absorb all byes, which is the correct proactive bye distribution.
function _pairsFromSeedSeq(ranked, BYE) {
  const n = ranked.length;
  const size = nextPow2(n);
  const seq = _seedSeq(size);
  const pairs = [];
  for (let i = 0; i < seq.length; i += 2) {
    const a = seq[i]     <= n ? ranked[seq[i] - 1]     : BYE;
    const b = seq[i + 1] <= n ? ranked[seq[i + 1] - 1] : BYE;
    pairs.push([a, b]);
  }
  return pairs;
}

// Pair a ranked array where adjacent seeds meet immediately (strongVsStrong intent).
// Byes are padded at the end so lower seeds absorb them, keeping top-seed matchups real.
function _pairsFromAdjacent(ranked, BYE) {
  const n = ranked.length;
  const size = nextPow2(n);
  const pairs = [];
  for (let i = 0; i < size; i += 2) {
    const a = i     < n ? ranked[i]     : BYE;
    const b = i + 1 < n ? ranked[i + 1] : BYE;
    pairs.push([a, b]);
  }
  return pairs;
}

// ── Pair helpers ──────────────────────────────────────────────────────────────

// Pair an ordered player list ensuring different teams face each other.
function pairCrossTeam(ordered, getEntry, teamOf) {
  const pairs = [];
  const used = new Set();

  for (let i = 0; i < ordered.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const pa = ordered[i];
    const teamA = teamOf[pa] || '';

    let found = -1;
    for (let j = i + 1; j < ordered.length; j++) {
      if (used.has(j)) continue;
      const teamB = teamOf[ordered[j]] || '';
      if (!teamA || !teamB || teamA !== teamB) { found = j; break; }
    }
    if (found === -1) {
      for (let j = i + 1; j < ordered.length; j++) {
        if (!used.has(j)) { found = j; break; }
      }
    }

    if (found === -1) {
      pairs.push([getEntry(pa), BYE_ENTRY]);
    } else {
      used.add(found);
      pairs.push([getEntry(pa), getEntry(ordered[found])]);
    }
  }
  return pairs;
}

// Swap mismatched same-player pairs with later pairs to avoid R1 self-matchups.
function _fixSamePlayer(paired) {
  for (let i = 0; i < paired.length; i++) {
    if (paired[i][0].player !== 'SYSTEM' && paired[i][0].player === paired[i][1].player) {
      for (let j = i + 1; j < paired.length; j++) {
        if (paired[j][1].player !== paired[i][0].player && paired[j][0].player !== paired[i][0].player) {
          [paired[i][1], paired[j][1]] = [paired[j][1], paired[i][1]];
          break;
        }
      }
    }
  }
}

// ── Main bracket builder ──────────────────────────────────────────────────────
//
// Options:
//   entries   — flat array of { player, character } in slot order per player
//   style     — 'strongVsStrong' | 'strongVsWeak' | 'random'
//   poolMode  — 'slot' | 'freePool'
//   seedMode  — 'elo' | 'kills' | 'winpct' | 'points'
//   teamMode  — boolean (use cross-team pairing)
//   teamOf    — { [player]: teamName }
//   statsMap  — { [player]: [statObj] }
//
// Returns [[entryA, entryB], ...] padded to nextPow2 with BYE_ENTRY pairs.

function buildBracketPairs({ entries, style, poolMode, seedMode = 'elo', teamMode = false, teamOf = {}, statsMap = {} }) {
  const BYE = BYE_ENTRY;

  // Enrichment phase: compute each entry's seed score exactly once before any sorting.
  // All comparators below use this Map — O(1) lookups instead of repeated stat searches.
  const _score = new Map(entries.map(e => [e, getSeedByMode(e, statsMap, seedMode)]));
  const seed = e => _score.get(e) ?? -1;

  // Group entries by player, preserving order (index = slot)
  const playerGroups = {};
  entries.forEach(e => {
    if (!playerGroups[e.player]) playerGroups[e.player] = [];
    playerGroups[e.player].push(e);
  });
  const players = Object.keys(playerGroups);
  const maxChars = Math.max(...Object.values(playerGroups).map(g => g.length));

  const pairs = [];

  // ── Free Pool ──────────────────────────────────────────────────────────────
  if (poolMode === 'freePool') {

    if (style === 'strongVsStrong') {
      // Each wave: take each player's best remaining char, sort globally, pair adjacent
      const rem = {};
      players.forEach(p => { rem[p] = [...playerGroups[p]].sort((a, b) => seed(b) - seed(a)); });
      for (let wave = 0; wave < maxChars; wave++) {
        let w = players.filter(p => rem[p].length > 0).map(p => rem[p].shift());
        w.sort((a, b) => seed(b) - seed(a));
        if (w.length % 2 === 1) w.push(BYE);
        for (let i = 0; i + 1 < w.length; i += 2) pairs.push([w[i], w[i + 1]]);
      }

    } else if (style === 'random') {
      // Each wave: shuffle each player's remaining chars, pair adjacent
      const rem = {};
      players.forEach(p => { rem[p] = shuffleArr([...playerGroups[p]]); });
      for (let wave = 0; wave < maxChars; wave++) {
        let w = players.filter(p => rem[p].length > 0).map(p => rem[p].shift());
        shuffleArr(w);
        if (w.length % 2 === 1) w.push(BYE);
        for (let i = 0; i + 1 < w.length; i += 2) pairs.push([w[i], w[i + 1]]);
      }

    } else {
      // strongVsWeak: global sort, pair best vs worst across waves,
      // one appearance per player per wave. pairedThisWave tracks real progress
      // so a wave that made pairs doesn't incorrectly trigger the BYE fallback.
      const allEntries = [];
      players.forEach(p => playerGroups[p].forEach(e => allEntries.push(e)));
      allEntries.sort((a, b) => seed(b) - seed(a));
      const n = allEntries.length;
      const taken = new Array(n).fill(false);
      let totalPaired = 0;

      while (totalPaired < n) {
        const usedThisWave = new Set();
        let pairedThisWave = 0;
        let innerProgress = true;

        while (innerProgress) {
          innerProgress = false;
          let lo = -1, hi = -1;
          for (let k = 0; k < n; k++) {
            if (!taken[k] && !usedThisWave.has(allEntries[k].player)) { lo = k; break; }
          }
          if (lo === -1) break;
          for (let k = n - 1; k > lo; k--) {
            if (!taken[k] && !usedThisWave.has(allEntries[k].player) && allEntries[k].player !== allEntries[lo].player) { hi = k; break; }
          }
          if (hi === -1) break;

          pairs.push([allEntries[lo], allEntries[hi]]);
          taken[lo] = taken[hi] = true;
          usedThisWave.add(allEntries[lo].player);
          usedThisWave.add(allEntries[hi].player);
          totalPaired += 2;
          pairedThisWave++;
          innerProgress = true;
        }

        if (pairedThisWave === 0) {
          for (let k = 0; k < n; k++) {
            if (!taken[k]) { pairs.push([allEntries[k], BYE]); taken[k] = true; totalPaired++; }
          }
          break;
        }
      }
    }

  // ── Per-Slot, Random ───────────────────────────────────────────────────────
  } else if (style === 'random') {
    const shuffledGroups = {};
    players.forEach(p => { shuffledGroups[p] = shuffleArr([...playerGroups[p]]); });

    const flat = [];
    for (let slot = 0; slot < maxChars; slot++) {
      shuffleArr([...players]).forEach(p => {
        if (shuffledGroups[p][slot]) flat.push(shuffledGroups[p][slot]);
      });
    }

    if (teamMode) {
      const teamOfIdx = Object.fromEntries(flat.map((e, i) => [i, teamOf[e.player] || '']));
      pairs.push(...pairCrossTeam(flat.map((_, i) => i), i => flat[i], teamOfIdx));
    } else {
      // Swap adjacent same-player entries
      for (let i = 0; i < flat.length - 1; i++) {
        if (flat[i].player !== 'SYSTEM' && flat[i].player === flat[i + 1].player) {
          for (let j = i + 2; j < flat.length; j++) {
            if (flat[j].player !== flat[i].player) { [flat[i + 1], flat[j]] = [flat[j], flat[i + 1]]; break; }
          }
        }
      }
      if (flat.length % 2 === 1) flat.push(BYE);
      for (let i = 0; i + 1 < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
    }

  // ── Per-Slot, Seeded ───────────────────────────────────────────────────────
  } else {
    for (let slot = 0; slot < maxChars; slot++) {
      // Rank players for this slot by descending seed score (enriched, O(1) lookup)
      const slotPlayers = [...players]
        .filter(p => playerGroups[p][slot])
        .sort((a, b) => seed(playerGroups[b][slot]) - seed(playerGroups[a][slot]));

      if (slotPlayers.length === 0) continue;
      const ranked = slotPlayers.map(p => playerGroups[p][slot]);

      if (teamMode) {
        pairs.push(...pairCrossTeam(slotPlayers, p => playerGroups[p][slot] || BYE, teamOf));
      } else if (style === 'strongVsStrong') {
        // Adjacent seeds meet first; byes fall to lower seeds at the tail
        pairs.push(..._pairsFromAdjacent(ranked, BYE));
      } else {
        // strongVsWeak: standard bracket folding — top seeds get byes and stay apart
        pairs.push(..._pairsFromSeedSeq(ranked, BYE));
      }
    }
  }

  // Align total pair count to the next power of 2 (handles cross-slot remainders)
  const target = nextPow2(pairs.length);
  while (pairs.length < target) pairs.push([BYE, BYE]);
  return pairs;
}
