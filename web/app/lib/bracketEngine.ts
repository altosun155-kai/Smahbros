// bracketEngine.ts — TS port of web/public/js/bracket-engine.js. Shared by
// tournament.html and bracket.html (draft-lineup generation vs. manual
// bracket generation) -- ported once here, used by both Next.js pages, so
// the pairing algorithm can't drift between the two the way it could if
// each page re-typed it.

export interface Entry {
  player: string;
  character: string;
}

export const BYE_ENTRY: Entry = { player: 'SYSTEM', character: 'BYE' };

export type BracketStyle = 'strongVsStrong' | 'strongVsWeak' | 'random';
export type PoolMode = 'slot' | 'freePool';
export type SeedMode = 'elo' | 'kills' | 'winpct' | 'points';

export interface StatRow {
  character: string;
  elo?: number;
  kills?: number;
  wins?: number;
  losses?: number;
  points?: number;
  provisional?: boolean;
}

export type StatsMap = Record<string, StatRow[]>;

export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function shuffleArr<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findStat(entry: Entry | null, statsMap: StatsMap): StatRow | null {
  if (!entry || entry.player === 'SYSTEM') return null;
  return (statsMap[entry.player] || []).find((s) => s.character === entry.character) || null;
}

export function getSeedElo(entry: Entry | null, statsMap: StatsMap): number {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = findStat(entry, statsMap);
  if (!s) return 1000;
  // Provisional (small-sample) Elo is noisy -- seed those as neutral 1000
  // rather than letting a handful of games swing bracket placement.
  if (s.provisional) return 1000;
  return s.elo || 1000;
}

export function getSeedKills(entry: Entry | null, statsMap: StatsMap): number {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = findStat(entry, statsMap);
  return s ? s.kills || 0 : 0;
}

export function getSeedWinPct(entry: Entry | null, statsMap: StatsMap): number {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = findStat(entry, statsMap);
  if (!s) return 0;
  const total = (s.wins || 0) + (s.losses || 0);
  return total >= 3 ? (s.wins || 0) / total : 0;
}

export function getSeedPoints(entry: Entry | null, statsMap: StatsMap): number {
  if (!entry || entry.player === 'SYSTEM') return -1;
  const s = findStat(entry, statsMap);
  return s ? s.points || 0 : 0;
}

export function getSeedByMode(entry: Entry | null, statsMap: StatsMap, seedMode: SeedMode): number {
  if (seedMode === 'kills') return getSeedKills(entry, statsMap);
  if (seedMode === 'winpct') return getSeedWinPct(entry, statsMap);
  if (seedMode === 'elo') return getSeedElo(entry, statsMap);
  return getSeedPoints(entry, statsMap);
}

export function buildBracketPairs({
  entries,
  style,
  poolMode,
  seedMode = 'elo',
  statsMap = {},
}: {
  entries: Entry[];
  style: BracketStyle;
  poolMode: PoolMode;
  seedMode?: SeedMode;
  statsMap?: StatsMap;
}): [Entry, Entry][] {
  const BYE = BYE_ENTRY;
  const seed = (e: Entry) => getSeedByMode(e, statsMap, seedMode);

  const playerGroups: Record<string, Entry[]> = {};
  entries.forEach((e) => {
    if (!playerGroups[e.player]) playerGroups[e.player] = [];
    playerGroups[e.player].push(e);
  });
  const players = Object.keys(playerGroups);
  const maxChars = Math.max(...Object.values(playerGroups).map((g) => g.length));

  const pairs: [Entry, Entry][] = [];

  if (poolMode === 'freePool') {
    if (style === 'strongVsStrong') {
      const rem: Record<string, Entry[]> = {};
      players.forEach((p) => {
        rem[p] = [...playerGroups[p]].sort((a, b) => seed(b) - seed(a));
      });
      for (let wave = 0; wave < maxChars; wave++) {
        const w = players.filter((p) => rem[p].length > 0).map((p) => rem[p].shift() as Entry);
        w.sort((a, b) => seed(b) - seed(a));
        if (w.length % 2 === 1) w.push(BYE);
        for (let i = 0; i + 1 < w.length; i += 2) pairs.push([w[i], w[i + 1]]);
      }
    } else if (style === 'random') {
      const rem: Record<string, Entry[]> = {};
      players.forEach((p) => {
        rem[p] = shuffleArr([...playerGroups[p]]);
      });
      for (let wave = 0; wave < maxChars; wave++) {
        const w = players.filter((p) => rem[p].length > 0).map((p) => rem[p].shift() as Entry);
        shuffleArr(w);
        if (w.length % 2 === 1) w.push(BYE);
        for (let i = 0; i + 1 < w.length; i += 2) pairs.push([w[i], w[i + 1]]);
      }
    } else {
      // strongVsWeak: global sort, pair best vs worst across waves, one
      // appearance per player per wave.
      const allEntries: Entry[] = [];
      players.forEach((p) => playerGroups[p].forEach((e) => allEntries.push(e)));
      allEntries.sort((a, b) => seed(b) - seed(a));
      const n = allEntries.length;
      const taken = new Array(n).fill(false);
      let totalPaired = 0;

      while (totalPaired < n) {
        const usedThisWave = new Set<string>();
        let pairedThisWave = 0;
        let innerProgress = true;

        while (innerProgress) {
          innerProgress = false;
          let lo = -1;
          let hi = -1;
          for (let k = 0; k < n; k++) {
            if (!taken[k] && !usedThisWave.has(allEntries[k].player)) {
              lo = k;
              break;
            }
          }
          if (lo === -1) break;
          for (let k = n - 1; k > lo; k--) {
            if (!taken[k] && !usedThisWave.has(allEntries[k].player) && allEntries[k].player !== allEntries[lo].player) {
              hi = k;
              break;
            }
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
            if (!taken[k]) {
              pairs.push([allEntries[k], BYE]);
              taken[k] = true;
              totalPaired++;
            }
          }
          break;
        }
      }
    }
  } else if (style === 'random') {
    const shuffledGroups: Record<string, Entry[]> = {};
    players.forEach((p) => {
      shuffledGroups[p] = shuffleArr([...playerGroups[p]]);
    });

    const flat: Entry[] = [];
    for (let slot = 0; slot < maxChars; slot++) {
      shuffleArr([...players]).forEach((p) => {
        if (shuffledGroups[p][slot]) flat.push(shuffledGroups[p][slot]);
      });
    }

    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].player !== 'SYSTEM' && flat[i].player === flat[i + 1].player) {
        for (let j = i + 2; j < flat.length; j++) {
          if (flat[j].player !== flat[i].player) {
            [flat[i + 1], flat[j]] = [flat[j], flat[i + 1]];
            break;
          }
        }
      }
    }
    if (flat.length % 2 === 1) flat.push(BYE);
    for (let i = 0; i + 1 < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  } else {
    for (let slot = 0; slot < maxChars; slot++) {
      const ordered = [...players].filter((p) => playerGroups[p][slot]).sort((a, b) => seed(playerGroups[b][slot]) - seed(playerGroups[a][slot]));
      if (ordered.length === 0) continue;
      const getEntry = (p: string) => playerGroups[p][slot] || BYE;

      if (style === 'strongVsStrong') {
        for (let i = 0; i + 1 < ordered.length; i += 2) pairs.push([getEntry(ordered[i]), getEntry(ordered[i + 1])]);
        if (ordered.length % 2 === 1) pairs.push([getEntry(ordered[ordered.length - 1]), BYE]);
      } else {
        let lo = 0;
        let hi = ordered.length - 1;
        while (lo < hi) pairs.push([getEntry(ordered[lo++]), getEntry(ordered[hi--])]);
        if (lo === hi) pairs.push([getEntry(ordered[lo]), BYE]);
      }
    }
  }

  const target = nextPow2(pairs.length);
  while (pairs.length < target) pairs.push([BYE, BYE]);

  return pairs;
}

// ── bracket-options.js's non-DOM logic (buildEntriesFromLineups) ──────────
export function buildEntriesFromLineups(confirmedLineups: Record<string, string[]>, playerStats: StatsMap, seedMode: SeedMode = 'elo'): Entry[] {
  return Object.entries(confirmedLineups).flatMap(([player, chars]) => {
    if (!chars || chars.length === 0) return [];
    const stats = playerStats[player] || [];
    const score = (c: string) => {
      const s = stats.find((st) => st.character === c);
      if (!s) return seedMode === 'kills' || seedMode === 'winpct' ? 0 : 1000;
      if (seedMode === 'kills') return s.kills || 0;
      if (seedMode === 'winpct') {
        const total = (s.wins || 0) + (s.losses || 0);
        return total >= 3 ? (s.wins || 0) / total : 0;
      }
      return s.elo || 1000;
    };
    return [...chars].sort((a, b) => score(b) - score(a)).map((c) => ({ player, character: c }));
  });
}
