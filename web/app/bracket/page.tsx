// /bracket — port of web/public/bracket.html, the manual bracket generator:
// entry grid (hand-picked characters per player), swap-mode editing, VS-modal
// scoring with clash-free but Elo-preview-and-ring-flash presentation, save
// draft / start lineup phase / start live tournament, Quick Start presets,
// and the "you already have a live tournament" banner.
//
// The entry grid's auto-fill (Elo/Kills/Win%/Favorites/Tier-list quick-fill)
// is NOT ported -- it was already dead on the legacy page (see CLAUDE.md
// Known Gaps): `getEntryPoints()`/`buildEntryGrid()` read a `fillMode` radio
// group that was never actually rendered anywhere in the HTML, so every
// character picker in the entry grid has always started empty in production.
// This port reproduces that: entries start with an empty character, hand-pick
// only.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageContainer, { PageHeader } from '../components/PageContainer';
import BracketOptionsPicker, { type BracketOptionsValue } from '../components/BracketOptionsPicker';
import { apiDelete, apiGet, apiPatch, apiPost, showToast } from '../lib/api';
import { SMASH_ROSTER, charHeadUrl, charImgUrl } from '../lib/chars';
import { BadgePill, loadAllBadges, type BadgeInfo } from '../lib/badges';
import {
  buildBracketPairs,
  getSeedElo,
  getSeedKills,
  getSeedPoints,
  getSeedWinPct,
  type BracketStyle,
  type Entry,
  type SeedMode,
  type StatsMap,
} from '../lib/bracketEngine';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './bracket.css';

type BadgeMap = Record<string, BadgeInfo>;
type Pair = [Entry, Entry];
type RoundPair = [Entry | null, Entry | null];

interface Preset {
  id: number;
  name: string;
  creator: string;
  players: string[];
  fill_mode: string;
  seed_mode: string;
  bracket_style: string;
  pool_mode: string;
  chars_per_player: number;
}

interface Connection {
  username: string;
  avatar_url: string | null;
  active: boolean;
}

const FILL_LABELS: Record<string, string> = { elo: 'Elo fill', kills: 'Kills fill', winpct: 'Win% fill', favorites: 'Favorites', tierlist: 'Tier list' };
const SEED_LABELS: Record<string, string> = { elo: 'Elo seed', kills: 'Kills seed', winpct: 'Win% seed' };
const STYLE_LABELS: Record<string, string> = { strongVsStrong: 'Strong vs Strong', strongVsWeak: 'Strong vs Weak', random: 'Random draw' };
const POOL_LABELS: Record<string, string> = { slot: 'Per Slot', freePool: 'Free Pool' };

function isBye(e: Entry | null): boolean {
  return !!e && e.character.toUpperCase() === 'BYE';
}

function entryLabel(e: Entry | null): string {
  if (!e) return '';
  if (isBye(e)) return 'BYE';
  return `${e.player} — ${e.character}`;
}

function getWinnerOf(ri: number, matchIdx: number, pairs: RoundPair[], roundWinners: Record<string, string>): Entry | null {
  if (matchIdx >= pairs.length) return null;
  const [a, b] = pairs[matchIdx];
  if (!a && !b) return null;
  if (!a) return b && !isBye(b) ? b : null;
  if (!b) return a && !isBye(a) ? a : null;
  if (isBye(a)) return b;
  if (isBye(b)) return a;
  const key = `r${ri}_m${matchIdx}`;
  const picked = roundWinners[key];
  const la = entryLabel(a);
  const lb = entryLabel(b);
  if (picked === la) return a;
  if (picked === lb) return b;
  return null;
}

function computeRounds(r1: Pair[], roundWinners: Record<string, string>): RoundPair[][] {
  const rounds: RoundPair[][] = [r1.map((p) => [p[0], p[1]] as RoundPair)];
  let prev: RoundPair[] = rounds[0];
  let ri = 0;
  while (prev.length > 1) {
    const next: RoundPair[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = getWinnerOf(ri, i, prev, roundWinners);
      const b = getWinnerOf(ri, i + 1, prev, roundWinners);
      next.push([a, b]);
    }
    rounds.push(next);
    prev = next;
    ri++;
  }
  return rounds;
}

function roundName(ri: number, total: number): string {
  if (ri === total - 1 && total > 1) return total === 2 ? 'Finals' : 'Grand Final';
  if (ri === total - 2 && total > 2) return 'Semifinals';
  if (ri === total - 3 && total > 3) return 'Quarterfinals';
  return `Round ${ri + 1}`;
}

// ── Elo preview math -- same formula copied per-page as duel/tournament
// (mirrors routers/matches.py's _k_factor/_mov_multiplier/_elo_change).
function kFactor(rank: number): number {
  if (rank <= 10) return 20;
  if (rank <= 25) return 30;
  return 50;
}
interface LbRow {
  username: string;
  character: string;
  elo?: number;
}
function rankAfter(lb: LbRow[], username: string, character: string, newElo: number): number {
  let rank = 1;
  for (const e of lb) {
    if (e.username === username && e.character === character) continue;
    if ((e.elo || 1000) > newElo) rank++;
  }
  return rank;
}
function eloDeltas(winnerElo: number, loserElo: number, wk: number, lk: number, winnerRank: number, loserRank: number) {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const diff = wk - lk;
  const mov = diff >= 3 ? 2.0 : diff === 2 ? 1.5 : 1.25;
  const surprise = 1 - expected;
  return {
    winner: Math.max(1, Math.round(kFactor(winnerRank) * surprise * mov)),
    loser: Math.max(1, Math.round(kFactor(loserRank) * surprise * mov)),
  };
}

function getPlayerAvatar(allUserAvatars: Record<string, string | null>, username: string) {
  return allUserAvatars[username] || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(username)}`;
}

const SCENARIOS = [
  { id: '30', aWins: true, wk: 3, lk: 0 },
  { id: '31', aWins: true, wk: 3, lk: 1 },
  { id: '32', aWins: true, wk: 3, lk: 2 },
  { id: '03', aWins: false, wk: 3, lk: 0 },
  { id: '13', aWins: false, wk: 3, lk: 1 },
  { id: '23', aWins: false, wk: 3, lk: 2 },
] as const;

export default function BracketPage() {
  useDocumentTitle('Smash Bracket — Bracket Generator');
  const router = useRouter();

  const [myUsername, setMyUsername] = useState('');
  const [badges, setBadges] = useState<BadgeMap>({});
  const allUserAvatarsRef = useRef<Record<string, string | null>>({});
  const allUserStatsRef = useRef<StatsMap>({});

  // ── Sidebar / entry setup ────────────────────────────────────────────────
  const [playersText, setPlayersText] = useState('');
  const [charsPerPlayer, setCharsPerPlayer] = useState(2);
  const [bracketOpts, setBracketOpts] = useState<BracketOptionsValue>({ style: 'strongVsStrong', seedMode: 'elo' });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [addedUsernames, setAddedUsernames] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Entry grid ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryGridVisible, setEntryGridVisible] = useState(false);
  const [entriesVisible, setEntriesVisible] = useState(true);

  // ── Bracket ───────────────────────────────────────────────────────────────
  const [currentBracket, setCurrentBracket] = useState<Pair[]>([]);
  const [roundWinners, setRoundWinners] = useState<Record<string, string>>({});
  const [roundScores, setRoundScores] = useState<Record<string, string>>({});
  const [bracketK, setBracketK] = useState(32);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState<{ pairIdx: number; slot: 0 | 1 } | null>(null);
  const [statusText, setStatusText] = useState('');
  const [showWinnerBanner, setShowWinnerBanner] = useState(false);
  const [winnerBannerName, setWinnerBannerName] = useState('');
  const [pendingEloDelta, setPendingEloDelta] = useState<Record<string, number>>({});
  const lastRenderedRoundsRef = useRef<RoundPair[][]>([]);

  const bracketOutputVisible = currentBracket.length > 0;

  // ── Live tournament state ────────────────────────────────────────────────
  const [bracketName, setBracketName] = useState('');
  const [liveTournamentId, setLiveTournamentId] = useState<number | null>(null);
  const [liveTournamentUrl, setLiveTournamentUrl] = useState<string | null>(null);
  const launchingRef = useRef(false);
  const [liveTourneyBanner, setLiveTourneyBanner] = useState<{ name: string; id: number } | null>(null);

  // ── Quick Start presets ──────────────────────────────────────────────────
  const [presets, setPresets] = useState<Preset[]>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<number | null>(null);
  const [spName, setSpName] = useState('');
  const [spFillMode, setSpFillMode] = useState('elo');
  const [spSeedMode, setSpSeedMode] = useState('elo');
  const [spBracketStyle, setSpBracketStyle] = useState('strongVsStrong');
  const [spPoolMode, setSpPoolMode] = useState('slot');
  const [spCpp, setSpCpp] = useState('2');

  // ── VS modal ──────────────────────────────────────────────────────────────
  const [vsOpen, setVsOpen] = useState(false);
  const vsKeyRef = useRef<string | null>(null);
  const [vsA, setVsA] = useState<Entry | null>(null);
  const [vsB, setVsB] = useState<Entry | null>(null);
  const [vsSeedA, setVsSeedA] = useState('');
  const [vsSeedB, setVsSeedB] = useState('');
  const [vsEloPreview, setVsEloPreview] = useState<Record<string, string>>({});
  const lbCacheRef = useRef<LbRow[] | null>(null);

  const bracketRoundsRef = useRef<HTMLDivElement>(null);

  const players = playersText
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p && p.toUpperCase() !== 'BYE');

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet<{ username: string; avatar_url: string | null }>('/users/me');
        if (!cancelled && me) {
          setMyUsername(me.username);
          setPlayersText(me.username);
          try {
            const data = await apiGet<{ character: string; elo?: number; kills?: number; wins?: number; losses?: number; points?: number }[]>('/characters/stats');
            allUserStatsRef.current[me.username] = (data || []).filter((s) => (s.wins || 0) + (s.losses || 0) > 0);
          } catch {
            // auto-fill is dead anyway (see file-level note); stats just back the VS-modal seed display
          }
        }
      } catch {
        // handled by requireAuth-equivalent guard elsewhere
      }

      try {
        await loadAllBadges().then((b) => {
          if (!cancelled) setBadges(b);
        });
      } catch {
        // badges are cosmetic
      }
      try {
        const allUsers = await apiGet<{ username: string; avatar_url: string | null }[]>('/users/all');
        allUsers.forEach((u) => {
          allUserAvatarsRef.current[u.username] = u.avatar_url || null;
        });
      } catch {
        // avatars fall back to dicebear
      }

      try {
        const conns = await apiGet<Connection[]>('/users/connections');
        if (!cancelled) setConnections(conns || []);
      } catch {
        if (!cancelled) setConnections([]);
      }

      try {
        const [ownBrackets, invitedLive] = await Promise.all([
          apiGet<{ id: number; name: string; is_live: boolean }[]>('/brackets').catch(() => []),
          apiGet<{ id: number; name: string }[]>('/brackets/live').catch(() => []),
        ]);
        const ownLive = (ownBrackets || []).filter((b) => b.is_live);
        const allLive = [...ownLive, ...(invitedLive || [])];
        if (!cancelled && allLive.length > 0) {
          setLiveTourneyBanner({ name: allLive[0].name, id: allLive[0].id });
        }
      } catch {
        // banner is a convenience, not required
      }

      try {
        const p = await apiGet<Preset[]>('/presets');
        if (!cancelled) setPresets(p || []);
      } catch {
        if (!cancelled) setPresets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadPresets() {
    try {
      setPresets((await apiGet<Preset[]>('/presets')) || []);
    } catch {
      // leave list as-is on transient failure
    }
  }

  // ── Entry grid ────────────────────────────────────────────────────────────
  function buildEntryGrid() {
    if (!players.length) {
      showToast('Add players first.', 'warn');
      return;
    }
    // Round-robin: give each player their 1st char slot, then 2nd, ... See
    // file-level note -- auto-fill is dead on the legacy page, so every slot
    // starts empty; this just lays out the (player, '') rows in that order.
    const next: Entry[] = [];
    for (let i = 0; i < charsPerPlayer; i++) {
      players.forEach((p) => next.push({ player: p, character: '' }));
    }
    setEntries(next);
    setEntryGridVisible(true);
  }

  function setEntryChar(idx: number, character: string) {
    setEntries((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], character };
      return next;
    });
  }

  // ── Bracket generation ───────────────────────────────────────────────────
  function generateBracket() {
    const base = entries.filter((e) => e.player && e.character);
    if (base.length < 2) {
      showToast('Add at least 2 entries with characters.', 'warn');
      return;
    }
    const pairs = buildBracketPairs({ entries: base, style: bracketOpts.style, poolMode: 'slot', seedMode: bracketOpts.seedMode, statsMap: allUserStatsRef.current });
    if (!pairs.length) {
      showToast('Could not build a valid bracket with those constraints.', 'error');
      return;
    }
    setCurrentBracket(pairs);
    setRoundWinners({});
    setRoundScores({});
    setShowWinnerBanner(false);
    setBracketK(Math.max(32, players.length * charsPerPlayer * 2));

    const playerCount = new Set(base.map((e) => e.player)).size;
    setStatusText(`${playerCount} players · ${pairs.length} R1 matches`);

    if (entryGridVisible && entriesVisible) setEntriesVisible(false);
  }

  function clearBracket() {
    setCurrentBracket([]);
    setRoundWinners({});
    setRoundScores({});
    setSwapMode(false);
    setSwapSelection(null);
    setStatusText('');
    setShowWinnerBanner(false);
  }

  // ── Swap mode ─────────────────────────────────────────────────────────────
  function toggleSwapMode() {
    setSwapMode((v) => !v);
    setSwapSelection(null);
  }

  function handleEntryClick(pairIdx: number, slot: 0 | 1) {
    const entry = currentBracket[pairIdx][slot];
    if (!entry || entry.player === 'SYSTEM') return;

    if (!swapSelection) {
      setSwapSelection({ pairIdx, slot });
      return;
    }
    const { pairIdx: pi2, slot: sl2 } = swapSelection;
    if (pi2 === pairIdx && sl2 === slot) {
      setSwapSelection(null);
      return;
    }
    setCurrentBracket((prev) => {
      const next = prev.map((p) => [...p] as Pair);
      const tmp = next[pairIdx][slot];
      next[pairIdx][slot] = next[pi2][sl2];
      next[pi2][sl2] = tmp;
      return next;
    });
    setSwapSelection(null);
    setRoundWinners({});
    setRoundScores({});
  }

  // ── Match result recording ───────────────────────────────────────────────
  async function recordMatchResult(winnerLabel: string, loserLabel: string, winnerKills: number, loserKills: number, key: string | null) {
    const winner = parseLabel(winnerLabel);
    const loser = parseLabel(loserLabel);
    if (!winner || !loser) return;
    if (winner.player === 'SYSTEM' || loser.player === 'SYSTEM') return;
    try {
      const res = await apiPost<{ elo_delta?: number }>('/matches/record', {
        winner_username: winner.player,
        winner_char: winner.character,
        winner_kills: winnerKills,
        loser_username: loser.player,
        loser_char: loser.character,
        loser_kills: loserKills,
        bracket_id: liveTournamentId || null,
      });
      if (key && res && res.elo_delta !== undefined) {
        setPendingEloDelta((prev) => ({ ...prev, [key]: res.elo_delta as number }));
      }
      await Promise.all(
        [winner.player, loser.player].map(async (p) => {
          try {
            const d = await apiGet<{ stats: { character: string; elo?: number; kills?: number; wins?: number; losses?: number }[] }>(`/characters/stats/${encodeURIComponent(p)}`);
            allUserStatsRef.current[p] = (d.stats || []).filter((s) => (s.wins || 0) + (s.losses || 0) > 0);
          } catch {
            // stale stats just mean a slightly stale seed preview next match
          }
        })
      );
    } catch (err) {
      showToast('Could not save match result: ' + (err as Error).message, 'error');
    }
  }

  function parseLabel(label: string): { player: string; character: string } | null {
    const idx = label.indexOf(' — ');
    if (idx === -1) return null;
    return { player: label.slice(0, idx), character: label.slice(idx + 3) };
  }

  function setWinner(key: string, val: string, winnerKills = 0, loserKills = 0) {
    const rounds = lastRenderedRoundsRef.current;
    const prev = roundWinners[key];
    setRoundWinners((r) => ({ ...r, [key]: val }));
    if (winnerKills > 0 || loserKills > 0) {
      setRoundScores((r) => ({ ...r, [key]: `${winnerKills}-${loserKills}` }));
    }
    if (!val || val === prev) return;

    const isGrandFinal = rounds.length > 1 && key === `r${rounds.length - 1}_m0`;
    if (isGrandFinal) {
      const we = parseLabel(val);
      if (we) {
        setWinnerBannerName(we.player);
        setShowWinnerBanner(true);
      }
    }

    if (liveTournamentId) {
      const sc = winnerKills > 0 || loserKills > 0 ? `${winnerKills}-${loserKills}` : null;
      const patchBody: Record<string, unknown> = { key, winner: val, score: sc };
      if (isGrandFinal) {
        const we = parseLabel(val);
        if (we) patchBody.tournament_winner = we.player;
      }
      apiPatch(`/brackets/${liveTournamentId}/winner`, patchBody).catch(() => {});
    }

    const match = key.match(/^r(\d+)_m(\d+)$/);
    if (!match) return;
    const ri = parseInt(match[1], 10);
    const mi = parseInt(match[2], 10);
    const round = rounds[ri];
    if (!round || !round[mi]) return;
    const [a, b] = round[mi];
    const la = entryLabel(a);
    const lb = entryLabel(b);
    const loserLabel = val === la ? lb : la;
    const winnerEntry = parseLabel(val);
    const loserEntry = parseLabel(loserLabel);
    if (winnerEntry && loserEntry && winnerEntry.player === loserEntry.player) return;
    recordMatchResult(val, loserLabel, winnerKills, loserKills, key);
  }

  // ── VS modal ──────────────────────────────────────────────────────────────
  async function getLb(): Promise<LbRow[]> {
    if (lbCacheRef.current !== null) return lbCacheRef.current;
    try {
      lbCacheRef.current = await apiGet<LbRow[]>('/characters/stats/leaderboard/elo');
    } catch {
      lbCacheRef.current = [];
    }
    return lbCacheRef.current || [];
  }

  function openVsModal(a: Entry, b: Entry, key: string) {
    vsKeyRef.current = key;
    setVsA(a);
    setVsB(b);
    setVsOpen(true);
    setVsEloPreview({});

    const seedMode = bracketOpts.seedMode;
    let seedA: number, seedB: number;
    if (seedMode === 'kills') {
      seedA = getSeedKills(a, allUserStatsRef.current);
      seedB = getSeedKills(b, allUserStatsRef.current);
      setVsSeedA(seedA > 0 ? `${seedA} kills` : '');
      setVsSeedB(seedB > 0 ? `${seedB} kills` : '');
    } else if (seedMode === 'winpct') {
      seedA = getSeedWinPct(a, allUserStatsRef.current);
      seedB = getSeedWinPct(b, allUserStatsRef.current);
      setVsSeedA(seedA > 0 ? `${Math.round(seedA * 100)}%` : '');
      setVsSeedB(seedB > 0 ? `${Math.round(seedB * 100)}%` : '');
    } else if (seedMode === 'elo') {
      seedA = getSeedElo(a, allUserStatsRef.current);
      seedB = getSeedElo(b, allUserStatsRef.current);
      setVsSeedA(`${seedA} elo`);
      setVsSeedB(`${seedB} elo`);
    } else {
      seedA = getSeedPoints(a, allUserStatsRef.current);
      seedB = getSeedPoints(b, allUserStatsRef.current);
      setVsSeedA(seedA > 0 ? `${seedA} pts` : '');
      setVsSeedB(seedB > 0 ? `${seedB} pts` : '');
    }

    const eloA = getSeedElo(a, allUserStatsRef.current);
    const eloB = getSeedElo(b, allUserStatsRef.current);
    getLb().then((lb) => {
      const rankA = lb.length ? rankAfter(lb, a.player, a.character, eloA) : 999;
      const rankB = lb.length ? rankAfter(lb, b.player, b.character, eloB) : 999;
      const preview: Record<string, string> = {};
      for (const s of SCENARIOS) {
        const we = s.aWins ? eloA : eloB;
        const le = s.aWins ? eloB : eloA;
        const wRank = s.aWins ? rankA : rankB;
        const lRank = s.aWins ? rankB : rankA;
        const { winner } = eloDeltas(we, le, s.wk, s.lk, wRank, lRank);
        preview[s.id] = `+${winner}`;
      }
      setVsEloPreview(preview);
    });
  }

  function closeVsModal() {
    setVsOpen(false);
    vsKeyRef.current = null;
    setVsA(null);
    setVsB(null);
  }

  function advanceVsModal() {
    const key = vsKeyRef.current;
    const match = key && key.match(/^r(\d+)_m(\d+)$/);
    if (!match) {
      closeVsModal();
      return;
    }
    const ri = parseInt(match[1], 10);
    const mi = parseInt(match[2], 10);
    const round = lastRenderedRoundsRef.current[ri];
    if (!round) {
      closeVsModal();
      return;
    }
    for (let next = mi + 1; next < round.length; next++) {
      const [a, b] = round[next];
      if (!a || !b) continue;
      if (isBye(a) || isBye(b)) continue;
      const la = entryLabel(a);
      const lb = entryLabel(b);
      if (la === 'TBD' || lb === 'TBD' || !la || !lb) continue;
      openVsModal(a, b, `r${ri}_m${next}`);
      return;
    }
    closeVsModal();
  }

  function playWinnerFlash(imgEl: HTMLImageElement | null, onDone: () => void) {
    const gsap = (window as unknown as { gsap?: any }).gsap;
    if (!imgEl || imgEl.style.display === 'none' || !gsap) {
      onDone();
      return;
    }
    const rect = imgEl.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ring = document.createElement('div');
    ring.className = 'ring-flash';
    ring.style.left = rect.left + rect.width / 2 - size / 2 + 'px';
    ring.style.top = rect.top + rect.height / 2 - size / 2 + 'px';
    ring.style.width = size + 'px';
    ring.style.height = size + 'px';
    document.body.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    gsap.fromTo(imgEl, { scale: 0.4, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)', onComplete: onDone });
  }

  function pickScore(p1Stocks: number, p2Stocks: number) {
    const key = vsKeyRef.current;
    if (!key || !vsA || !vsB) return;
    const p1Won = p1Stocks > p2Stocks;
    const winner = p1Won ? entryLabel(vsA) : entryLabel(vsB);
    const winnerKills = Math.max(p1Stocks, p2Stocks);
    const loserKills = Math.min(p1Stocks, p2Stocks);
    setWinner(key, winner, winnerKills, loserKills);
    const imgId = p1Won ? 'vsP1CharImg' : 'vsP2CharImg';
    playWinnerFlash(document.getElementById(imgId) as HTMLImageElement | null, advanceVsModal);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeVsModal();
        setSavePresetOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Connector lines between rounds ───────────────────────────────────────
  const drawConnectors = useCallback(() => {
    const container = bracketRoundsRef.current;
    const rounds = lastRenderedRoundsRef.current;
    if (!container || rounds.length < 2) return;
    let svg = document.getElementById('bracketConnectors');
    if (svg) svg.remove();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(SVG_NS, 'svg') as unknown as HTMLElement;
    svg.id = 'bracketConnectors';
    const cRect = container.getBoundingClientRect();
    svg.setAttribute('width', String(container.scrollWidth));
    svg.setAttribute('height', String(container.scrollHeight));

    for (let ri = 0; ri < rounds.length - 1; ri++) {
      const round = rounds[ri];
      for (let mi = 0; mi < round.length; mi++) {
        const fromKey = `r${ri}_m${mi}`;
        const toKey = `r${ri + 1}_m${Math.floor(mi / 2)}`;
        const fromBox = container.querySelector(`.match-box[data-key="${fromKey}"]`);
        const toBox = container.querySelector(`.match-box[data-key="${toKey}"]`);
        if (!fromBox || !toBox) continue;
        const fr = fromBox.getBoundingClientRect();
        const tr = toBox.getBoundingClientRect();
        const x1 = fr.right - cRect.left + container.scrollLeft;
        const y1 = fr.top + fr.height / 2 - cRect.top + container.scrollTop;
        const x2 = tr.left - cRect.left + container.scrollLeft;
        const y2 = tr.top + tr.height / 2 - cRect.top + container.scrollTop;
        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', roundWinners[fromKey] ? 'rgba(0,180,255,0.6)' : 'rgba(255,255,255,0.12)');
        path.setAttribute('stroke-width', '2');
        path.dataset.key = fromKey;
        svg.appendChild(path);
      }
    }
    container.appendChild(svg);
  }, [roundWinners]);

  const rounds = currentBracket.length ? computeRounds(currentBracket, roundWinners) : [];
  lastRenderedRoundsRef.current = rounds;

  useEffect(() => {
    drawConnectors();
    // Count-up animation for a just-recorded match's Elo delta badge.
    const gsap = (window as unknown as { gsap?: any }).gsap;
    Object.entries(pendingEloDelta).forEach(([key, delta]) => {
      const span = document.getElementById(`eloDelta_${key}`);
      if (!span) return;
      if (!gsap) {
        span.textContent = (delta >= 0 ? '+' : '') + delta;
        return;
      }
      const proxy = { v: 0 };
      gsap.to(proxy, {
        v: delta,
        duration: 0.8,
        snap: 'v',
        onUpdate: () => {
          span.textContent = (proxy.v >= 0 ? '+' : '') + Math.round(proxy.v);
        },
      });
    });
    if (Object.keys(pendingEloDelta).length) setPendingEloDelta({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBracket, roundWinners, drawConnectors]);

  useEffect(() => {
    function onResize() {
      drawConnectors();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawConnectors]);

  // ── Sidebar / stepper ─────────────────────────────────────────────────────
  function adjustCPP(delta: number) {
    setCharsPerPlayer((v) => Math.max(1, Math.min(20, v + delta)));
  }

  function toggleFriend(username: string) {
    setAddedUsernames((prev) => {
      const next = new Set(prev);
      const current = players;
      if (current.includes(username)) {
        next.delete(username);
        setPlayersText(current.filter((p) => p !== username).join('\n'));
      } else {
        next.add(username);
        setPlayersText([...current, username].join('\n'));
      }
      return next;
    });
  }

  // ── Save draft / lineup phase / live tournament ──────────────────────────
  function getBracketPayload(name: string, isLive: boolean) {
    return {
      name,
      mode: 'regular',
      players,
      entries: entries.filter((e) => e.character),
      bracket_data: currentBracket.map(([a, b]) => ({ a: entryLabel(a), b: entryLabel(b) })),
      bracket_style: `${bracketOpts.style}|${bracketOpts.seedMode}|slot`,
      is_live: isLive,
      invite_usernames: [] as string[],
      chars_per_player: charsPerPlayer,
    };
  }

  async function startLineupPhase() {
    if (launchingRef.current) return;
    const name = bracketName.trim();
    if (!name) {
      showToast('Enter a tournament name first.', 'warn');
      return;
    }
    if (players.length < 2) {
      showToast('Add at least 2 players first.', 'warn');
      return;
    }
    launchingRef.current = true;
    try {
      const res = await apiPost<{ id: number }>('/brackets', {
        name,
        mode: 'regular',
        players,
        entries: [],
        bracket_data: [],
        bracket_style: `${bracketOpts.style}|${bracketOpts.seedMode}|slot`,
        is_live: true,
        invite_usernames: [],
        chars_per_player: charsPerPlayer,
      });
      setLiveTournamentId(res.id);
      router.push(`/tournament?id=${res.id}`);
    } catch (err) {
      launchingRef.current = false;
      showToast('Error starting lineup phase: ' + (err as Error).message, 'error');
    }
  }

  async function saveBracket() {
    const name = bracketName.trim();
    if (!name) {
      showToast('Enter a tournament name first.', 'warn');
      return;
    }
    try {
      await apiPost('/brackets', getBracketPayload(name, false));
      showToast(`Saved "${name}" as draft!`, 'success');
    } catch (err) {
      showToast('Error saving bracket: ' + (err as Error).message, 'error');
    }
  }

  async function startLiveTournament() {
    if (launchingRef.current) return;
    const name = bracketName.trim();
    if (!name) {
      showToast('Enter a tournament name first.', 'warn');
      return;
    }
    if (currentBracket.length === 0) {
      showToast('Generate a bracket first.', 'warn');
      return;
    }
    launchingRef.current = true;
    try {
      const res = await apiPost<{ id: number }>('/brackets', getBracketPayload(name, true));
      setLiveTournamentId(res.id);
      const url = `${window.location.origin}/tournament?id=${res.id}`;
      setLiveTournamentUrl(url);
      showToast(`"${name}" is now LIVE!`, 'success');
    } catch (err) {
      launchingRef.current = false;
      showToast('Error starting tournament: ' + (err as Error).message, 'error');
    }
  }

  async function endTournament() {
    if (!liveTournamentId) return;
    try {
      const result = await apiPatch<{ bonuses?: { place: string; player: string; char: string; bonus: number }[] }>(`/brackets/${liveTournamentId}/end`, {});
      setLiveTournamentId(null);
      setLiveTournamentUrl(null);
      const bonuses = result.bonuses || [];
      if (bonuses.length > 0) {
        const lines = bonuses.map((b) => `${b.place}: ${b.player} (${b.char}) +${b.bonus} Elo`).join(' · ');
        showToast(`Tournament ended! Placement bonuses — ${lines}`, 'success');
      } else {
        showToast('Tournament ended.', 'info');
      }
    } catch (err) {
      showToast('Error ending tournament: ' + (err as Error).message, 'error');
    }
  }

  // ── Quick Start presets ───────────────────────────────────────────────────
  async function launchPreset(id: number) {
    try {
      const res = await apiPost<{ id: number; name: string }>(`/presets/${id}/launch`, {});
      showToast(`${res.name} — lineup phase started!`, 'success');
      setTimeout(() => router.push(`/tournament?id=${res.id}`), 600);
    } catch (e) {
      showToast('Launch failed: ' + (e as Error).message, 'error');
    }
  }

  async function deletePreset(id: number) {
    if (!confirm('Delete this preset?')) return;
    try {
      await apiDelete(`/presets/${id}`);
      showToast('Preset deleted', 'success');
      reloadPresets();
    } catch (e) {
      showToast('Could not delete: ' + (e as Error).message, 'error');
    }
  }

  function openSavePreset() {
    if (!players.length) {
      showToast('Add players first', 'warn');
      return;
    }
    setEditingPresetId(null);
    setSpName('');
    setSpFillMode(FILL_LABELS[bracketOpts.seedMode] ? bracketOpts.seedMode : 'elo');
    setSpSeedMode(bracketOpts.seedMode);
    setSpBracketStyle(bracketOpts.style);
    setSpPoolMode('slot');
    setSpCpp(String(charsPerPlayer));
    setSavePresetOpen(true);
  }

  function openEditPreset(preset: Preset) {
    setEditingPresetId(preset.id);
    setSpName(preset.name);
    setSpFillMode(preset.fill_mode || 'elo');
    setSpSeedMode(preset.seed_mode || 'elo');
    setSpBracketStyle(preset.bracket_style || 'strongVsStrong');
    setSpPoolMode(preset.pool_mode || 'slot');
    setSpCpp(String(preset.chars_per_player || 2));
    setSavePresetOpen(true);
  }

  async function savePreset() {
    const name = spName.trim();
    if (!name) {
      showToast('Give the preset a name', 'warn');
      return;
    }
    const settings = {
      name,
      fill_mode: spFillMode,
      seed_mode: spSeedMode,
      bracket_style: spBracketStyle,
      pool_mode: spPoolMode,
      chars_per_player: parseInt(spCpp, 10),
    };
    try {
      if (editingPresetId) {
        await apiPatch(`/presets/${editingPresetId}`, settings);
        showToast(`"${name}" updated!`, 'success');
      } else {
        if (players.length < 2) {
          showToast('Need at least 2 players', 'warn');
          return;
        }
        await apiPost('/presets', { ...settings, players });
        showToast(`"${name}" saved!`, 'success');
      }
      setSavePresetOpen(false);
      setEditingPresetId(null);
      reloadPresets();
    } catch (e) {
      showToast('Save failed: ' + (e as Error).message, 'error');
    }
  }

  const spPlayersDisplay = editingPresetId ? presets.find((p) => p.id === editingPresetId)?.players.join(', ') || '' : players.join(', ');

  return (
    <PageContainer>
      <Script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js" strategy="afterInteractive" />

      <PageHeader>
        <h1>🎮 Bracket Generator</h1>
        <p>Set up players, choose characters, then generate a single-elimination bracket.</p>
      </PageHeader>

      {liveTourneyBanner && (
        <div
          style={{
            borderRadius: 14,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 18,
            background: 'linear-gradient(135deg,rgba(231,76,60,0.18),rgba(192,57,43,0.1))',
            border: '1.5px solid rgba(231,76,60,0.45)',
          }}
        >
          <div style={{ width: 9, height: 9, background: '#e74c3c', borderRadius: '50%', flexShrink: 0, boxShadow: '0 0 8px #e74c3c', animation: 'pulseDot 1.2s ease-in-out infinite' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(231,76,60,0.9)' }}>Live Tournament — Lineup Phase</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveTourneyBanner.name}</div>
          </div>
          <Link href={`/tournament?id=${liveTourneyBanner.id}`} style={{ flexShrink: 0, background: '#e74c3c', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Watch Live / Submit Lineup →
          </Link>
        </div>
      )}

      {presets.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', marginBottom: 10 }}>⚡ Quick Start</div>
          <div className="qs-strip">
            {presets.map((p) => (
              <div key={p.id} className="qs-card">
                <div className="qs-card-name">{p.name}</div>
                <div className="qs-card-players">{p.players.join(' · ')}</div>
                <div className="qs-card-meta">
                  {SEED_LABELS[p.seed_mode] || p.seed_mode} &nbsp;·&nbsp;
                  {STYLE_LABELS[p.bracket_style] || p.bracket_style} &nbsp;·&nbsp;
                  {POOL_LABELS[p.pool_mode || 'slot']}
                  <br />
                  {p.chars_per_player} char{p.chars_per_player !== 1 ? 's' : ''}/player
                </div>
                <div className="qs-card-actions">
                  <button type="button" className="qs-launch-btn" onClick={() => launchPreset(p.id)}>
                    ⚡ Launch
                  </button>
                  {p.creator === myUsername && (
                    <button type="button" className="qs-delete-btn" title="Edit" style={{ fontSize: '0.9rem' }} onClick={() => openEditPreset(p)}>
                      ✏️
                    </button>
                  )}
                  {p.creator === myUsername && (
                    <button type="button" className="qs-delete-btn" title="Delete" onClick={() => deletePreset(p.id)}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" className="qs-add-card" onClick={openSavePreset}>
              ＋ New Preset
            </button>
          </div>
        </div>
      )}

      {savePresetOpen && (
        <div
          id="savePresetModal"
          className="open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSavePresetOpen(false);
          }}
        >
          <div className="sp-box">
            <h3>{editingPresetId ? '✏️ Edit Preset' : '💾 Save as Preset'}</h3>
            <div className="sp-row">
              <label>Preset Name</label>
              <input type="text" value={spName} onChange={(e) => setSpName(e.target.value)} placeholder="e.g. Friday Night Smash" maxLength={40} />
            </div>
            {(editingPresetId || players.length > 0) && (
              <div className="sp-row">
                <label>Players</label>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 7, minHeight: 36 }}>{spPlayersDisplay}</div>
              </div>
            )}
            <div className="sp-row">
              <label>Character Fill</label>
              <select value={spFillMode} onChange={(e) => setSpFillMode(e.target.value)}>
                <option value="elo">Auto-fill by Elo</option>
                <option value="kills">Auto-fill by Kills</option>
                <option value="winpct">Auto-fill by Win %</option>
              </select>
            </div>
            <div className="sp-row">
              <label>Seeding</label>
              <select value={spSeedMode} onChange={(e) => setSpSeedMode(e.target.value)}>
                <option value="elo">Elo</option>
                <option value="kills">Kills</option>
                <option value="winpct">Win %</option>
              </select>
            </div>
            <div className="sp-row">
              <label>Bracket Style</label>
              <select value={spBracketStyle} onChange={(e) => setSpBracketStyle(e.target.value)}>
                <option value="strongVsStrong">Strong vs Strong</option>
                <option value="strongVsWeak">Strong vs Weak</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="sp-row">
              <label>Character Pool</label>
              <select value={spPoolMode} onChange={(e) => setSpPoolMode(e.target.value)}>
                <option value="slot">Per Slot</option>
                <option value="freePool">Free Pool</option>
              </select>
            </div>
            <div className="sp-row">
              <label>Characters per Player</label>
              <select value={spCpp} onChange={(e) => setSpCpp(e.target.value)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
            <div className="sp-actions">
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={savePreset}>
                {editingPresetId ? 'Update Preset' : 'Save Preset'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setSavePresetOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bracket-layout">
        <button type="button" className="sidebar-toggle-btn" onClick={() => setSidebarCollapsed((v) => !v)} title="Toggle sidebar">
          {sidebarCollapsed ? '▶ Setup' : '◀ Setup'}
        </button>

        <div className={`sidebar-wrap${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-card" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <BracketOptionsPicker value={bracketOpts} onChange={setBracketOpts} />
            </div>

            <h2>Players (one per line)</h2>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <textarea rows={5} placeholder={'You\nFriend1\nFriend2'} value={playersText} onChange={(e) => setPlayersText(e.target.value)} />
            </div>

            <h2 style={{ marginTop: 8 }}>Characters per Player</h2>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, height: 34 }}>
                <button
                  type="button"
                  onClick={() => adjustCPP(-1)}
                  style={{ padding: '0 13px', height: '100%', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRight: 'none', borderRadius: '6px 0 0 6px', color: 'var(--text)', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}
                >
                  −
                </button>
                <div style={{ minWidth: 36, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card-bg2)', border: '1px solid var(--border)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', padding: '0 10px' }}>{charsPerPlayer}</div>
                <button
                  type="button"
                  onClick={() => adjustCPP(1)}
                  style={{ padding: '0 13px', height: '100%', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: 'var(--text)', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <h2>Add Players</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {connections.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No other players yet.</span>}
                {connections.map((f) => {
                  const added = addedUsernames.has(f.username) || players.includes(f.username);
                  const avatarSrc = f.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}`;
                  return (
                    <div key={f.username} className={`friend-chip${added ? ' added' : ''}`} onClick={() => toggleFriend(f.username)}>
                      <img
                        src={avatarSrc}
                        alt={f.username}
                        onError={(e) => ((e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}`)}
                      />
                      <span className={f.active ? 'online-dot' : 'offline-dot'} />
                      {f.username}
                    </div>
                  );
                })}
              </div>
            </div>

            <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={buildEntryGrid}>
              Build Entry Grid
            </button>
          </div>

          {entryGridVisible && (
            <div className="sidebar-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ marginBottom: 0 }}>Entries</h2>
                <button type="button" className="btn btn-sm" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.75rem' }} onClick={() => setEntriesVisible((v) => !v)}>
                  {entriesVisible ? 'Hide' : 'Show'}
                </button>
              </div>
              <div style={{ display: entriesVisible ? 'block' : 'none' }}>
                {entries.map((entry, idx) => (
                  <div key={idx} className="player-row">
                    <span className="player-label">{entry.player}</span>
                    <EntryCharPicker value={entry.character} onSelect={(c) => setEntryChar(idx, c)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {bracketOutputVisible ? (
            <div>
              {showWinnerBanner && (
                <div id="winnerBanner" className="show">
                  <div className="win-title">🏆 Tournament Champion</div>
                  <div className="win-name">{winnerBannerName}</div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <button type="button" className={`btn btn-outline btn-sm${swapMode ? ' active' : ''}`} onClick={toggleSwapMode}>
                  {swapMode ? '✅ Done Editing' : '✏️ Edit / Swap Entries'}
                </button>
                <button type="button" className="btn btn-sm" style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} onClick={clearBracket}>
                  Clear
                </button>
              </div>
              {swapMode && <div className="swap-banner visible">Swap mode ON — click any R1 entry to select it, then click another to swap. Click the button again to exit.</div>}

              <div className="bracket-rounds" id="bracketRounds" ref={bracketRoundsRef}>
                {rounds.map((round, ri) => (
                  <div key={ri} className={`round-col${ri === rounds.length - 1 && rounds.length > 1 ? ' grand-final' : ''}`}>
                    <div className="round-title">{roundName(ri, rounds.length)}</div>
                    {round.map(([a, b], mi) => {
                      const key = `r${ri}_m${mi}`;
                      const la = a ? entryLabel(a) : 'TBD';
                      const lb = b ? entryLabel(b) : 'TBD';
                      const matchIsBye = isBye(a) || isBye(b);
                      const curWinner = roundWinners[key] || '';
                      return (
                        <div
                          key={mi}
                          className="match-box"
                          data-key={key}
                          onClick={
                            !swapMode && !matchIsBye && a && b && la !== 'TBD' && lb !== 'TBD'
                              ? (e) => {
                                  if ((e.target as HTMLElement).tagName === 'SELECT') return;
                                  openVsModal(a, b, key);
                                }
                              : undefined
                          }
                        >
                          <BracketEntry entry={a} label={la} slot={0} pairIdx={mi} swapMode={swapMode} swapSelection={swapSelection} curWinner={curWinner} matchKey={key} roundScores={roundScores} pendingEloDelta={pendingEloDelta} badges={badges} onEntryClick={handleEntryClick} />
                          <BracketEntry entry={b} label={lb} slot={1} pairIdx={mi} swapMode={swapMode} swapSelection={swapSelection} curWinner={curWinner} matchKey={key} roundScores={roundScores} pendingEloDelta={pendingEloDelta} badges={badges} onEntryClick={handleEntryClick} />
                          {!swapMode && !matchIsBye && la !== 'TBD' && lb !== 'TBD' && (
                            <select
                              className="winner-select"
                              value={curWinner}
                              onChange={(e) => setWinner(key, e.target.value)}
                              style={{ background: '#0f0f17', border: '1px solid rgba(255,255,255,0.15)', color: '#e8edf3', borderRadius: 5 }}
                            >
                              <option value="">— Pick winner —</option>
                              <option value={la}>{la}</option>
                              <option value={lb}>{lb}</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="save-bracket-row">
                <input
                  type="text"
                  value={bracketName}
                  onChange={(e) => setBracketName(e.target.value)}
                  placeholder="Tournament name (e.g. Friday Night S3)"
                  style={{ margin: 0, flex: 1, padding: '9px 12px', background: '#0f0f17', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.93rem' }}
                />
                <button type="button" className="btn btn-gold btn-sm" onClick={startLiveTournament}>
                  🏆 Start Live Tournament
                </button>
                <button type="button" className="btn btn-sm" style={{ background: 'rgba(39,174,96,0.15)', border: '1px solid rgba(39,174,96,0.5)', color: '#27ae60' }} onClick={startLineupPhase}>
                  📋 Lineup Phase
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={saveBracket}>
                  Save Draft
                </button>
                <button type="button" className="btn btn-sm" style={{ background: 'rgba(100,60,255,.15)', border: '1px solid rgba(100,60,255,.4)', color: '#a78bfa' }} onClick={openSavePreset}>
                  💾 Save Preset
                </button>
              </div>

              {liveTournamentId && liveTournamentUrl && (
                <div style={{ marginTop: 12, background: 'rgba(39,174,96,0.12)', border: '1px solid rgba(39,174,96,0.35)', borderRadius: 8, padding: '12px 16px', fontSize: '0.88rem', color: '#27ae60' }}>
                  <strong>🟢 Tournament is LIVE</strong> — share the link so players can join.
                  <span style={{ marginLeft: 8 }}>
                    <Link href={`/tournament?id=${liveTournamentId}`} style={{ color: '#27ae60', textDecoration: 'underline' }}>
                      Open →
                    </Link>
                    <input
                      readOnly
                      value={liveTournamentUrl}
                      style={{ marginLeft: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(39,174,96,0.4)', color: '#ccc', borderRadius: 4, padding: '2px 6px', fontSize: '0.8rem', width: 260 }}
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(liveTournamentUrl).then(() => showToast('Link copied!', 'success'))}
                      style={{ marginLeft: 6, background: 'rgba(39,174,96,0.2)', border: '1px solid rgba(39,174,96,0.4)', color: '#27ae60', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                      Copy
                    </button>
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 12 }} onClick={endTournament}>
                    End Tournament
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '32px 0' }}>Configure players and click &quot;Generate Bracket&quot; to get started.</div>
          )}

          {bracketOutputVisible && (
            <div style={{ display: 'flex', background: 'rgba(255,224,102,0.07)', border: '1px solid rgba(255,224,102,0.2)', borderRadius: 8, padding: '7px 14px', fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 1 }}>Elo Rewards</span>
              <span>
                🥇 <span style={{ color: '#ffe066' }}>+{bracketK}</span>
              </span>
              <span>
                🥈 <span style={{ color: '#c0c0c0' }}>+{Math.round(bracketK * 0.5)}</span>
              </span>
              <span>
                🥉 <span style={{ color: '#cd7f32' }}>+{Math.round(bracketK * 0.25)}</span>
              </span>
            </div>
          )}

          <div className="sticky-bar">
            <button type="button" className="btn btn-gold" onClick={generateBracket}>
              Generate Bracket
            </button>
            <button type="button" className="btn btn-outline" onClick={clearBracket}>
              Clear
            </button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: 4 }}>{statusText}</span>
          </div>
        </div>
      </div>

      {vsOpen && vsA && vsB && (
        <VsModal
          a={vsA}
          b={vsB}
          seedA={vsSeedA}
          seedB={vsSeedB}
          eloPreview={vsEloPreview}
          badges={badges}
          getAvatar={(u: string) => getPlayerAvatar(allUserAvatarsRef.current, u)}
          onClose={closeVsModal}
          onPick={pickScore}
        />
      )}
    </PageContainer>
  );
}

// ── Entry-grid character picker ──────────────────────────────────────────────
function EntryCharPicker({ value, onSelect }: { value: string; onSelect: (c: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const q = text.toLowerCase();
  const matches = SMASH_ROSTER.filter((c) => !q || c.toLowerCase().includes(q));

  function pick(c: string) {
    setText(c);
    setOpen(false);
    onSelect(c);
  }

  return (
    <div className="char-picker">
      <input
        className="char-picker-input"
        type="text"
        placeholder="— Search character —"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setFocusedIdx(-1);
          if (!e.target.value) onSelect('');
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setOpen(false);
            if (!SMASH_ROSTER.includes(text)) setText(value);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusedIdx((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusedIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusedIdx >= 0 && matches[focusedIdx]) pick(matches[focusedIdx]);
            else if (matches.length === 1) pick(matches[0]);
          } else if (e.key === 'Escape') {
            setText(value);
            setOpen(false);
          }
        }}
      />
      <div className={`char-picker-dropdown${open ? ' open' : ''}`}>
        {matches.length ? (
          matches.map((c, i) => (
            <div key={c} className={`char-picker-option${c === value ? ' selected' : ''}${i === focusedIdx ? ' focused' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              {c}
            </div>
          ))
        ) : (
          <div className="char-picker-none">No match</div>
        )}
      </div>
    </div>
  );
}

// ── One bracket-box entry (player — character) ───────────────────────────────
function BracketEntry({
  entry,
  label,
  slot,
  pairIdx,
  swapMode,
  swapSelection,
  curWinner,
  matchKey,
  roundScores,
  pendingEloDelta,
  badges,
  onEntryClick,
}: {
  entry: Entry | null;
  label: string;
  slot: 0 | 1;
  pairIdx: number;
  swapMode: boolean;
  swapSelection: { pairIdx: number; slot: 0 | 1 } | null;
  curWinner: string;
  matchKey: string;
  roundScores: Record<string, string>;
  pendingEloDelta: Record<string, number>;
  badges: BadgeMap;
  onEntryClick: (pairIdx: number, slot: 0 | 1) => void;
}) {
  if (!entry || label === 'TBD') return <div className="match-entry tbd">— TBD —</div>;

  const entryIsBye = entry.character.toUpperCase() === 'BYE';
  const isWon = curWinner === label;
  const isLost = !!curWinner && curWinner !== label;
  const iconUrl = !entryIsBye ? charHeadUrl(entry.character) : null;
  const sc = roundScores[matchKey];
  const scoreBadge = isWon && sc;
  const hasEloBadge = isWon && pendingEloDelta[matchKey] !== undefined;

  const isSelected = swapMode && swapSelection && swapSelection.pairIdx === pairIdx && swapSelection.slot === slot;
  const swapCls = swapMode && entry.player !== 'SYSTEM' ? (isSelected ? ' swap-selected' : ' swap-hover') : '';

  return (
    <div
      className={`match-entry${entryIsBye ? ' bye' : ''}${swapCls}${isWon ? ' winner-highlight' : ''}`}
      style={isLost ? { opacity: 0.45 } : undefined}
      onClick={swapMode ? () => onEntryClick(pairIdx, slot) : undefined}
    >
      {iconUrl && <img className="match-char-icon" src={iconUrl} alt={entry.character} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label} {!entryIsBye && <BadgePill badges={badges} username={entry.player} />}
      </span>
      {scoreBadge && (
        <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ffe066', background: 'rgba(255,224,102,0.12)', border: '1px solid rgba(255,224,102,0.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{sc}</span>
      )}
      {hasEloBadge && (
        <span id={`eloDelta_${matchKey}`} style={{ fontSize: '0.68rem', fontWeight: 800, color: '#4caf50', flexShrink: 0 }}>
          +0
        </span>
      )}
    </div>
  );
}

// ── VS modal ──────────────────────────────────────────────────────────────────
function VsModal({
  a,
  b,
  seedA,
  seedB,
  eloPreview,
  badges,
  getAvatar,
  onClose,
  onPick,
}: {
  a: Entry;
  b: Entry;
  seedA: string;
  seedB: string;
  eloPreview: Record<string, string>;
  badges: BadgeMap;
  getAvatar: (username: string) => string;
  onClose: () => void;
  onPick: (p1s: number, p2s: number) => void;
}) {
  const avatarA = getAvatar(a.player);
  const avatarB = getAvatar(b.player);
  const charImgA = charImgUrl(a.character);
  const charImgB = charImgUrl(b.character);

  const p1Scenarios = [
    { id: '30', label: '3-0', wk: 3, lk: 0 },
    { id: '31', label: '3-1', wk: 3, lk: 1 },
    { id: '32', label: '3-2', wk: 3, lk: 2 },
  ];
  const p2Scenarios = [
    { id: '03', label: '0-3', wk: 3, lk: 0 },
    { id: '13', label: '1-3', wk: 3, lk: 1 },
    { id: '23', label: '2-3', wk: 3, lk: 2 },
  ];

  return (
    <div id="vsModal" className="open">
      <div className="vs-bg">
        <div className="vs-bg-left">
          <img id="vsBgImgLeft" src={avatarA} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} onError={(e) => ((e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(a.player)}`)} />
        </div>
        <div className="vs-bg-right">
          <img id="vsBgImgRight" src={avatarB} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} onError={(e) => ((e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(b.player)}`)} />
        </div>
        <div className="vs-bg-center" />
        <div className="vs-lightning" />
      </div>

      <button type="button" className="vs-close" onClick={onClose}>
        ✕ Close
      </button>

      <div className="vs-content">
        <div className="vs-player p1-side">
          {charImgA && <img className="vs-char-img" id="vsP1CharImg" src={charImgA} alt="" />}
          <div className="vs-player-info">
            <div className="vs-player-tag p1">P1</div>
            <img className="vs-avatar" id="vsP1Avatar" src={avatarA} alt="P1" onError={(e) => ((e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(a.player)}`)} />
            <div className="vs-name p1">
              {a.player} <BadgePill badges={badges} username={a.player} />
            </div>
            <div className="vs-char-name">{a.character}</div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-gold)' }}>{seedA}</div>
          </div>
        </div>

        <div className="vs-middle">
          <div className="vs-logo">Super Smash Bros. Ultimate</div>
          <div className="vs-text">VS</div>
        </div>

        <div className="vs-player p2-side">
          {charImgB && <img className="vs-char-img" id="vsP2CharImg" src={charImgB} alt="" />}
          <div className="vs-player-info">
            <div className="vs-player-tag p2">P2</div>
            <img className="vs-avatar" id="vsP2Avatar" src={avatarB} alt="P2" onError={(e) => ((e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(b.player)}`)} />
            <div className="vs-name p2">
              {b.player} <BadgePill badges={badges} username={b.player} />
            </div>
            <div className="vs-char-name">{b.character}</div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-gold)', textAlign: 'right' }}>{seedB}</div>
          </div>
        </div>
      </div>

      <div className="vs-winner-row" style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)' }}>Pick Score (stocks)</div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
            <div style={{ fontSize: '0.62rem', color: '#ff8888', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{a.player} Wins</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              {p1Scenarios.map((s) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: '0.6rem', color: '#4caf50', fontWeight: 700 }}>{eloPreview[s.id] || ''}</span>
                  <button type="button" className="score-preset-btn p1-btn" onClick={() => onPick(s.wk, s.lk)}>
                    {s.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div style={{ width: 1, height: 50, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
            <div style={{ fontSize: '0.62rem', color: '#88aaff', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{b.player} Wins</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              {p2Scenarios.map((s) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: '0.6rem', color: '#4caf50', fontWeight: 700 }}>{eloPreview[s.id] || ''}</span>
                  <button type="button" className="score-preset-btn p2-btn" onClick={() => onPick(s.lk, s.wk)}>
                    {s.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
