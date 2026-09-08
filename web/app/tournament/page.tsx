// /tournament — port of web/public/tournament.html (the live single-elim
// bracket screen: lineup phase, matchup preview/swap, bracket rendering, the
// full-screen VS score modal with clash animations, live matchup swap,
// character-edit picker, undo bar, and end-tournament confirmation).
//
// Ported at full fidelity, per instruction -- including the clash-animation
// system, which is built the same way the legacy page builds it (imperative
// DOM nodes appended into a layer, auto-removed after their animation ends)
// rather than reimplemented as React state, since that's exactly the kind of
// fire-and-forget, non-reactive visual effect the DOM was already the right
// tool for; wrapping it in React state would only add renders no one reads.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PageContainer from '../components/PageContainer';
import BracketOptionsPicker, { type BracketOptionsValue } from '../components/BracketOptionsPicker';
import SurvivorStrip from '../components/SurvivorStrip';
import { apiDelete, apiGet, apiPatch, apiPost, getToken, showToast, wsUrl } from '../lib/api';
import { SMASH_ROSTER, charHeadUrl, charImgUrl } from '../lib/chars';
import { BadgePill, loadAllBadges, type BadgeInfo } from '../lib/badges';
import { buildBracketPairs, buildEntriesFromLineups, type BracketStyle, type Entry, type SeedMode } from '../lib/bracketEngine';
import { parseLabel } from '../lib/bracketSurvivors';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './tournament.css';

type BadgeMap = Record<string, BadgeInfo>;

interface Pair {
  a: string | null;
  b: string | null;
}

interface BracketData {
  id: number;
  name: string;
  mode: string | null;
  players: string[];
  bracket_data: Pair[];
  round_winners: Record<string, string>;
  round_scores: Record<string, string>;
  bracket_style: string;
  is_live: boolean;
  winner: string | null;
  host: string;
  chars_per_player: number;
  confirmed_lineups: Record<string, string[]>;
  can_record?: boolean;
}

interface EloLbRow {
  username: string;
  character: string;
  elo?: number;
}

interface CharStatRow {
  character: string;
  elo?: number;
  kills?: number;
  wins?: number;
  losses?: number;
  points?: number;
  provisional?: boolean;
}

// ── Elo preview math -- mirrors routers/matches.py's _k_factor/_mov_multiplier
// /_elo_change exactly (verified against backend source, same as duel.tsx's
// copy). Only ever called with winner-stock margins of 3-0/3-1/3-2.
function kFactor(rank: number): number {
  if (rank <= 10) return 20;
  if (rank <= 25) return 30;
  return 50;
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

// Doubles as both "current rank" (pass the entry's current elo) and
// "rank after" (pass a hypothetical new elo) -- same as duel.tsx's rankAfter,
// which is why the legacy page's separate _tRankOf/_tRankAfter collapse into
// one function here.
function rankAfter(lb: EloLbRow[], username: string, character: string, newElo: number): number {
  let rank = 1;
  for (const e of lb) {
    if (e.username === username && e.character === character) continue;
    if ((e.elo || 1000) > newElo) rank++;
  }
  return rank;
}

// parseLabel is imported from ../lib/bracketSurvivors -- same behavior
// (null on anything without ' — ', including 'BYE'), extracted there so
// SurvivorStrip's computeSurvivors doesn't hand-roll a third copy of this
// alongside this file's own former copy and the backend's _parse_label.

// ── Round computation (computeRounds/getWinner) ───────────────────────────
function getWinner(ri: number, mi: number, pairs: [string | null, string | null][], roundWinners: Record<string, string>): string | null {
  if (mi >= pairs.length) return null;
  const [a, b] = pairs[mi];
  if (!a && !b) return null;
  if (!a || a === 'TBD') return b !== 'TBD' ? b : null;
  if (!b || b === 'TBD') return a !== 'TBD' ? a : null;
  if (a.toUpperCase() === 'BYE') return b;
  if (b.toUpperCase() === 'BYE') return a;
  const key = `r${ri}_m${mi}`;
  return roundWinners[key] || null;
}

function computeRounds(r1pairs: Pair[], roundWinners: Record<string, string>): [string | null, string | null][][] {
  const rounds: [string | null, string | null][][] = [r1pairs.map((p) => [p.a, p.b] as [string | null, string | null])];
  let prev = rounds[0];
  let ri = 0;
  while (prev.length > 1) {
    const next: [string | null, string | null][] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = getWinner(ri, i, prev, roundWinners);
      const b = getWinner(ri, i + 1, prev, roundWinners);
      next.push([a || 'TBD', b || 'TBD']);
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
  if (ri === total - 4 && total > 4) return 'Round of 16';
  if (ri === total - 5 && total > 5) return 'Round of 32';
  if (ri === total - 6 && total > 6) return 'Round of 64';
  return `Round ${ri + 1}`;
}

// ── Clash animation profiles (CHAR_PROFILES) ──────────────────────────────
const CHAR_PROFILES: Record<string, 'electric' | 'psychic' | 'swordie' | 'speed' | 'heavy'> = {
  Pikachu: 'electric', Pichu: 'electric',
  Mewtwo: 'psychic', Ness: 'psychic', Lucas: 'psychic', Lucario: 'psychic',
  Hero: 'psychic', Robin: 'psychic', 'Rosalina & Luma': 'psychic',
  Link: 'swordie', 'Young Link': 'swordie', 'Toon Link': 'swordie',
  Marth: 'swordie', Lucina: 'swordie', Ike: 'swordie', Roy: 'swordie',
  Chrom: 'swordie', Cloud: 'swordie', Corrin: 'swordie', Shulk: 'swordie',
  Byleth: 'swordie', 'Meta Knight': 'swordie', 'Mii Swordfighter': 'swordie',
  Sephiroth: 'swordie',
  Sonic: 'speed', 'Captain Falcon': 'speed', Fox: 'speed', Falco: 'speed',
  Sheik: 'speed', 'Zero Suit Samus': 'speed', Joker: 'speed',
  Bayonetta: 'speed', Wolf: 'speed', Greninja: 'speed',
  Bowser: 'heavy', 'Donkey Kong': 'heavy', 'King K. Rool': 'heavy',
  Ganondorf: 'heavy', Incineroar: 'heavy', 'King Dedede': 'heavy',
  Snake: 'heavy', Terry: 'heavy', 'Little Mac': 'heavy', Ridley: 'heavy',
  'Bowser Jr.': 'heavy',
};

function mk(layer: HTMLElement, cls: string, inlineStyle?: string, delayMs?: number) {
  const el = document.createElement('div');
  el.className = 'vsc-' + cls;
  if (inlineStyle) el.style.cssText = inlineStyle;
  if (delayMs) el.style.animationDelay = delayMs + 'ms';
  layer.appendChild(el);
}

function spawnEffect(layer: HTMLElement, profile: string) {
  switch (profile) {
    case 'electric':
      mk(layer, 'flash', 'width:280px;height:280px;margin-left:-140px;margin-top:-140px;background:radial-gradient(circle,rgba(255,240,0,0.75) 0%,transparent 70%)');
      mk(layer, 'ring', 'width:180px;height:180px;margin-left:-90px;margin-top:-90px;border-color:#ffe600;box-shadow:0 0 22px #ffe600,inset 0 0 12px rgba(255,230,0,0.25)');
      [0, 45, 90, 135, 180, 225, 270, 315].forEach((deg, i) => mk(layer, 'bolt', `--r:${deg}deg;background:#ffe600;box-shadow:0 0 7px #ffe600`, i * 18));
      break;
    case 'psychic':
      mk(layer, 'flash', 'width:260px;height:260px;margin-left:-130px;margin-top:-130px;background:radial-gradient(circle,rgba(180,80,255,0.65) 0%,transparent 70%)');
      ([[0, '#bb44ff'], [200, '#ff44cc'], [400, '#8833ee']] as [number, string][]).forEach(([d, c]) =>
        mk(layer, 'ring', `width:160px;height:160px;margin-left:-80px;margin-top:-80px;border-color:${c};box-shadow:0 0 16px ${c}`, d)
      );
      break;
    case 'swordie':
      mk(layer, 'flash', 'width:320px;height:320px;margin-left:-160px;margin-top:-160px;background:radial-gradient(circle,rgba(200,240,255,0.55) 0%,transparent 70%)');
      mk(layer, 'slash', 'width:460px;margin-left:-230px;margin-top:-3px;background:linear-gradient(to right,transparent,#ffffff,transparent);box-shadow:0 0 20px rgba(255,255,255,0.85)');
      mk(layer, 'slash', 'width:360px;margin-left:-180px;margin-top:10px;background:linear-gradient(to right,transparent,rgba(140,200,255,0.75),transparent)', 90);
      mk(layer, 'ring', 'width:160px;height:160px;margin-left:-80px;margin-top:-80px;border-color:rgba(200,235,255,0.75)', 130);
      break;
    case 'speed':
      mk(layer, 'flash', 'width:240px;height:240px;margin-left:-120px;margin-top:-120px;background:radial-gradient(circle,rgba(0,220,255,0.55) 0%,transparent 70%)');
      [-55, -28, 0, 28, 55].forEach((offset, i) =>
        mk(layer, 'streak', `top:calc(50% + ${offset}px - ${i === 2 ? 2 : 1}px);background:${i === 2 ? '#00eeff' : 'rgba(0,200,255,0.45)'};height:${i === 2 ? '4px' : '2px'};box-shadow:${i === 2 ? '0 0 10px #00eeff' : 'none'}`, i * 38)
      );
      break;
    case 'heavy':
      mk(layer, 'flash', 'width:320px;height:320px;margin-left:-160px;margin-top:-160px;background:radial-gradient(circle,rgba(255,80,0,0.6) 0%,transparent 70%)');
      mk(layer, 'wave', 'width:70px;height:70px;margin-left:-35px;margin-top:-35px;border-color:#ff5500;box-shadow:0 0 28px rgba(255,80,0,0.75),inset 0 0 14px rgba(255,60,0,0.3)');
      mk(layer, 'ring', 'width:120px;height:120px;margin-left:-60px;margin-top:-60px;border-color:rgba(255,200,0,0.55)', 220);
      break;
    default:
      mk(layer, 'flash', 'width:260px;height:260px;margin-left:-130px;margin-top:-130px;background:radial-gradient(circle,rgba(255,255,255,0.4) 0%,transparent 70%)');
      mk(layer, 'ring', 'width:180px;height:180px;margin-left:-90px;margin-top:-90px;border-color:rgba(255,255,255,0.7)');
  }
}

function spawnClash(charA: string, charB: string) {
  const old = document.getElementById('vsClashLayer');
  if (old) old.remove();
  const bg = document.querySelector('#scoreModal .vs-bg');
  if (!bg) return;
  const layer = document.createElement('div');
  layer.id = 'vsClashLayer';
  bg.appendChild(layer);

  const pA = CHAR_PROFILES[charA] || 'default';
  const pB = CHAR_PROFILES[charB] || 'default';
  spawnEffect(layer, pA);
  if (pB !== pA) spawnEffect(layer, pB);

  setTimeout(() => {
    if (layer.parentNode) layer.remove();
  }, 1600);
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

export default function TournamentPage() {
  useDocumentTitle('Smash Bracket — Live Tournament');
  const searchParams = useSearchParams();
  const tournamentId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [data, setData] = useState<BracketData | null>(null);
  const dataRef = useRef<BracketData | null>(null);
  dataRef.current = data;

  const [myUsername, setMyUsername] = useState('');
  const [badges, setBadges] = useState<BadgeMap>({});
  const allUserAvatarsRef = useRef<Record<string, string | null>>({});
  const eloCacheRef = useRef<Record<string, number>>({});
  const lbCacheRef = useRef<EloLbRow[] | null>(null);

  const isHost = !!data && myUsername === data.host;
  const canRecord = !!data?.can_record;

  // ── Lineup phase state ──────────────────────────────────────────────────
  const [lineupSlots, setLineupSlots] = useState<string[]>([]);
  const [favChars, setFavChars] = useState<string[]>([]);
  const lastMyLineupHash = useRef('');
  const [confirmed, setConfirmed] = useState(false);
  const [bracketOpts, setBracketOpts] = useState<BracketOptionsValue>({ style: 'strongVsStrong', seedMode: 'elo' });
  const liveControlsSet = useRef(false);

  // ── Matchup preview + swap (host, pre-generate) ─────────────────────────
  const [previewPairs, setPreviewPairs] = useState<{ a: string; b: string }[] | null>(null);
  const [previewEntries, setPreviewEntries] = useState<Entry[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSwapMode, setPreviewSwapMode] = useState(false);
  const [previewSwapSel, setPreviewSwapSel] = useState<{ pairIdx: number; slot: 0 | 1 } | null>(null);

  // ── Live matchup swap (host, post-generate) ─────────────────────────────
  const [liveSwapMode, setLiveSwapMode] = useState(false);
  const [liveSwapSel, setLiveSwapSel] = useState<number | null>(null);

  // ── Score modal ──────────────────────────────────────────────────────────
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const scoreModalKeyRef = useRef<string | null>(null);
  const [scoreModalA, setScoreModalA] = useState<{ player: string; character: string } | null>(null);
  const [scoreModalB, setScoreModalB] = useState<{ player: string; character: string } | null>(null);
  const [mobileWinner, setMobileWinner] = useState<'p1' | 'p2' | null>(null);
  const [modalElo, setModalElo] = useState({ a: 1000, b: 1000 });
  // Per-scenario Elo/rank preview, keyed by scenario id ("30","31",... "23").
  // Only ever rendered by the mobile winner-first picker -- the legacy
  // page's #desktopScoreGrid consumed the same data but is dead code (see
  // CLAUDE.md Known Gaps), so it's not ported.
  const [modalPreview, setModalPreview] = useState<Record<string, { elo: number; rankW: number | null; rankL: number | null }>>({});
  const [hoverPreview, setHoverPreview] = useState<{ p1Delta: number; p1Rank: number | null; p2Delta: number; p2Rank: number | null } | null>(null);
  const lastRenderedRoundsRef = useRef<[string | null, string | null][][]>([]);

  // ── Character picker modal ──────────────────────────────────────────────
  const [charPickerOldChar, setCharPickerOldChar] = useState<string | null>(null);
  const [charPickerSearch, setCharPickerSearch] = useState('');

  // ── End tournament modal ─────────────────────────────────────────────────
  const [endModalOpen, setEndModalOpen] = useState(false);

  // ── Undo bar ──────────────────────────────────────────────────────────────
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(30);
  const undoMatchKeyRef = useRef<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set only when the just-recorded match is the Grand Final -- once its own
  // 30s undo window closes with no undo taken, the tournament auto-ends.
  // Deliberately tied to the *same* undo timer/window rather than a separate,
  // shorter one: ending before the Grand Final's own correction window closes
  // would award placement bonuses that a same-match undo can no longer cleanly
  // reverse (undo only removes the round_winners entry, not paid-out Elo).
  const undoIsGrandFinalRef = useRef(false);

  const [wsEnded, setWsEnded] = useState(false);

  async function getCharElo(username: string, character: string): Promise<number> {
    const key = `${username}/${character}`;
    if (eloCacheRef.current[key] != null) return eloCacheRef.current[key];
    try {
      const d = await apiGet<{ stats: CharStatRow[] }>(`/characters/stats/${encodeURIComponent(username)}`);
      (d.stats || []).forEach((s) => {
        eloCacheRef.current[`${username}/${s.character}`] = s.elo || 1000;
      });
    } catch {
      // fall through to default below
    }
    return eloCacheRef.current[key] || 1000;
  }

  async function getLb(): Promise<EloLbRow[]> {
    if (lbCacheRef.current !== null) return lbCacheRef.current;
    try {
      lbCacheRef.current = await apiGet<EloLbRow[]>('/characters/stats/leaderboard/elo');
    } catch {
      lbCacheRef.current = [];
    }
    return lbCacheRef.current || [];
  }

  // ── Fetch + render ────────────────────────────────────────────────────────
  const fetchAndRender = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const d = await apiGet<BracketData & { mode: string }>(`/brackets/${tournamentId}`);
      if (d.mode === 'team_battle') {
        setLoading(false);
        showToast('This was a Team Battle bracket — that mode has been removed.', 'warn');
        return;
      }
      setData(d);
      setLoading(false);

      const hasBracket = d.bracket_data && d.bracket_data.length > 0;
      if (d.is_live && !hasBracket) {
        const myConfirmedNow = JSON.stringify((d.confirmed_lineups || {})[myUsername] || []);
        if (myConfirmedNow !== lastMyLineupHash.current || lineupSlots.length === 0) {
          lastMyLineupHash.current = myConfirmedNow;
          const k = d.chars_per_player || 2;
          const myConfirmedChars = (d.confirmed_lineups || {})[myUsername] || [];
          setLineupSlots(Array.from({ length: k }, (_, i) => myConfirmedChars[i] || ''));
          setConfirmed(myConfirmedChars.length > 0);
        }
        if (myUsername === d.host && !liveControlsSet.current) {
          liveControlsSet.current = true;
          const [savedStyle, savedSeedMode = 'elo'] = (d.bracket_style || 'strongVsStrong').split('|');
          setBracketOpts({ style: (savedStyle as BracketStyle) || 'strongVsStrong', seedMode: savedSeedMode as SeedMode });
        }
        if (!liveSwapMode) {
          // no-op; live swap only applies once a bracket exists
        }
      } else {
        if (liveSwapMode && !(myUsername === d.host && d.is_live)) {
          setLiveSwapMode(false);
          setLiveSwapSel(null);
        }
      }

      if (!d.is_live) setWsEnded(true);
    } catch {
      setLoading(false);
      setErrored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, myUsername, lineupSlots.length, liveSwapMode]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId) {
      setLoading(false);
      setErrored(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet<{ username: string }>('/users/me');
        if (!cancelled && me) setMyUsername(me.username);
      } catch {
        // handled by fetchAndRender's own error state
      }
      try {
        const allUsers = await apiGet<{ username: string; avatar_url: string | null }[]>('/users/all');
        allUsers.forEach((u) => {
          allUserAvatarsRef.current[u.username] = u.avatar_url || null;
        });
      } catch {
        // avatars fall back to dicebear per-username
      }
      loadAllBadges().then((b) => {
        if (!cancelled) setBadges(b);
      });
      if (!cancelled) await fetchAndRender();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  // Poll every 5s for live updates -- kept running alongside the WS listener
  // as a fallback; the WS connection has no reconnect logic, so if it drops,
  // the poll is what keeps this screen from going stale.
  useEffect(() => {
    if (!tournamentId || wsEnded) return;
    const t = setInterval(fetchAndRender, 5000);
    return () => clearInterval(t);
  }, [tournamentId, wsEnded, fetchAndRender]);

  // Fast-path live updates: pushed on matchup swap (POST /brackets/{id}/swap)
  // so all open screens react immediately instead of waiting up to 5s.
  useEffect(() => {
    if (!tournamentId) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(`/ws/tournament/${tournamentId}`));
    } catch {
      return;
    }
    ws.onopen = () => ws.send(getToken() || '');
    ws.onmessage = () => fetchAndRender();
    return () => ws.close();
  }, [tournamentId, fetchAndRender]);

  // Load favourites once for the lineup quick-pick row.
  useEffect(() => {
    if (!myUsername || favChars.length) return;
    apiGet<{ characters: string[] }>('/characters/favorites')
      .then((d) => setFavChars(d.characters || []))
      .catch(() => {});
  }, [myUsername, favChars.length]);

  // ── Lineup phase handlers ────────────────────────────────────────────────
  function quickPickChar(charName: string) {
    setLineupSlots((prev) => {
      const existingSlot = prev.indexOf(charName);
      if (existingSlot !== -1) {
        const next = [...prev];
        next[existingSlot] = '';
        return next;
      }
      let target = prev.findIndex((c) => !c);
      if (target === -1) target = prev.length - 1;
      const next = [...prev];
      next[target] = charName;
      return next;
    });
  }

  function selectLineupChar(slotIdx: number, charName: string) {
    const takenSlot = lineupSlots.findIndex((c, i) => c === charName && i !== slotIdx);
    if (takenSlot !== -1) {
      showToast(`${charName} is already in slot ${takenSlot + 1}.`, 'warn');
      return;
    }
    setLineupSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = charName;
      return next;
    });
  }

  async function confirmLineup() {
    const chars = lineupSlots.filter((c) => c && SMASH_ROSTER.includes(c));
    if (!chars.length) {
      showToast('Pick at least one character.', 'warn');
      return;
    }
    try {
      await apiPatch(`/brackets/${tournamentId}/confirm-lineup`, { characters: chars });
      showToast('Lineup confirmed!', 'success');
      setConfirmed(true);
      await fetchAndRender();
    } catch (err) {
      showToast('Error: ' + (err as Error).message, 'error');
    }
  }

  async function previewMatchups() {
    if (!data) return;
    const confirmedLineups = data.confirmed_lineups || {};
    const players = data.players || [];
    const savedStyle = (data.bracket_style || 'strongVsStrong').split('|');
    const style = bracketOpts.style || (savedStyle[0] as BracketStyle) || 'strongVsStrong';
    const seedMode = bracketOpts.seedMode || (savedStyle[1] as SeedMode) || 'elo';
    const poolMode = (savedStyle[2] as 'slot' | 'freePool') || 'slot';

    setPreviewLoading(true);
    const playerStats: Record<string, CharStatRow[]> = {};
    await Promise.all(
      players.map(async (p) => {
        try {
          const d = await apiGet<{ stats: CharStatRow[] }>(`/characters/stats/${encodeURIComponent(p)}`);
          playerStats[p] = d.stats || [];
        } catch {
          playerStats[p] = [];
        }
      })
    );
    setPreviewLoading(false);

    const entries = buildEntriesFromLineups(confirmedLineups, playerStats, seedMode);
    if (entries.length === 0) {
      showToast('No confirmed lineups yet.', 'warn');
      return;
    }
    const rawPairs = buildBracketPairs({ entries, style, poolMode, seedMode, statsMap: playerStats });
    const toLabel = (e: Entry) => (e.player === 'SYSTEM' ? 'BYE' : `${e.player} — ${e.character}`);
    const pairs = rawPairs.map(([a, b]) => ({ a: toLabel(a), b: toLabel(b) }));

    setPreviewEntries(entries.filter((e) => e.player !== 'SYSTEM'));
    setPreviewPairs(pairs);
    setPreviewSwapMode(false);
    setPreviewSwapSel(null);
  }

  function toggleMatchupSwap() {
    setPreviewSwapMode((v) => !v);
    setPreviewSwapSel(null);
  }

  function handlePreviewSwap(pairIdx: number, slot: 0 | 1) {
    if (!previewPairs) return;
    const val = slot === 0 ? previewPairs[pairIdx].a : previewPairs[pairIdx].b;
    if (!val || val === 'BYE') return;

    if (!previewSwapSel) {
      setPreviewSwapSel({ pairIdx, slot });
      return;
    }
    if (previewSwapSel.pairIdx === pairIdx && previewSwapSel.slot === slot) {
      setPreviewSwapSel(null);
      return;
    }
    const { pairIdx: pi2, slot: sl2 } = previewSwapSel;
    const next = previewPairs.map((p) => ({ ...p }));
    const getVal = (pi: number, sl: 0 | 1) => (sl === 0 ? next[pi].a : next[pi].b);
    const setVal = (pi: number, sl: 0 | 1, v: string) => {
      if (sl === 0) next[pi].a = v;
      else next[pi].b = v;
    };
    const tmp = getVal(pairIdx, slot);
    setVal(pairIdx, slot, getVal(pi2, sl2));
    setVal(pi2, sl2, tmp);
    setPreviewPairs(next);
    setPreviewSwapSel(null);
  }

  async function confirmMatchups() {
    if (!previewPairs) return;
    try {
      await apiPost(`/brackets/${tournamentId}/generate-from-lineups`, { bracket_data: previewPairs, entries: previewEntries });
      showToast('Bracket generated!', 'success');
      setPreviewPairs(null);
      await fetchAndRender();
    } catch (err) {
      showToast('Error generating bracket: ' + (err as Error).message, 'error');
    }
  }

  // ── Live matchup swap ────────────────────────────────────────────────────
  function toggleLiveSwap() {
    setLiveSwapMode((v) => !v);
    setLiveSwapSel(null);
  }

  // Mirrors _swap_positions' same-player check (routers/brackets.py) so the
  // host sees the warning before committing -- the backend still re-checks
  // and returns same_player_warning regardless; this is only a UX pre-check.
  function wouldCreateSamePlayer(posA: number, posB: number): boolean {
    const bracketData = data?.bracket_data || [];
    const slotOf = (pos: number): [number, 'a' | 'b'] => [Math.floor(pos / 2), pos % 2 === 0 ? 'a' : 'b'];
    const [miA, slotA] = slotOf(posA);
    const [miB, slotB] = slotOf(posB);
    if (!bracketData[miA] || !bracketData[miB]) return false;
    const pairA: Pair = { ...bracketData[miA] };
    const pairB: Pair = miB === miA ? pairA : { ...bracketData[miB] };
    const valA = pairA[slotA];
    const valB = pairB[slotB];
    pairA[slotA] = valB;
    pairB[slotB] = valA;
    const playerOf = (label: string | null) => (label && label.includes(' — ') ? label.split(' — ')[0] : null);
    const pairs = miA === miB ? [pairA] : [pairA, pairB];
    return pairs.some((p) => {
      const pa = playerOf(p.a);
      const pb = playerOf(p.b);
      return !!pa && !!pb && pa === pb;
    });
  }

  async function handleLiveSwapClick(pos: number) {
    if (liveSwapSel === null) {
      setLiveSwapSel(pos);
      return;
    }
    if (liveSwapSel === pos) {
      setLiveSwapSel(null);
      return;
    }
    const posA = liveSwapSel;
    const posB = pos;
    setLiveSwapSel(null);

    if (wouldCreateSamePlayer(posA, posB)) {
      const ok = confirm('This swap will put someone up against themselves (same player, both sides). Continue anyway?');
      if (!ok) return;
    }

    try {
      const res = await apiPost<{ same_player_warning?: boolean }>(`/brackets/${tournamentId}/swap`, { pos_a: posA, pos_b: posB });
      showToast(res.same_player_warning ? 'Swapped — heads up, that created a same-player matchup.' : 'Matchup swapped.', res.same_player_warning ? 'warn' : 'success');
      await fetchAndRender();
    } catch (err) {
      showToast('Could not swap: ' + (err as Error).message, 'error');
    }
  }

  // ── Score modal ───────────────────────────────────────────────────────────
  function openScoreModal(a: string, b: string, key: string) {
    const pa = parseLabel(a);
    const pb = parseLabel(b);
    if (!pa || !pb) return;
    scoreModalKeyRef.current = key;
    setScoreModalA(pa);
    setScoreModalB(pb);
    setMobileWinner(null);
    setModalPreview({});
    setHoverPreview(null);
    setScoreModalOpen(true);

    setTimeout(() => spawnClash(pa.character, pb.character), 80);

    Promise.all([getCharElo(pa.player, pa.character), getCharElo(pb.player, pb.character), getLb()]).then(([eloA, eloB, lb]) => {
      setModalElo({ a: eloA, b: eloB });
      const preview: Record<string, { elo: number; rankW: number | null; rankL: number | null }> = {};
      for (const s of SCENARIOS) {
        const we = s.aWins ? eloA : eloB;
        const le = s.aWins ? eloB : eloA;
        const wEntry = s.aWins ? pa : pb;
        const lEntry = s.aWins ? pb : pa;
        const wCurRank = lb.length ? rankAfter(lb, wEntry.player, wEntry.character, we) : 999;
        const lCurRank = lb.length ? rankAfter(lb, lEntry.player, lEntry.character, le) : 999;
        const { winner: wDelta, loser: lDelta } = eloDeltas(we, le, s.wk, s.lk, wCurRank, lCurRank);
        const rankW = lb.length ? rankAfter(lb, wEntry.player, wEntry.character, we + wDelta) : null;
        const rankL = lb.length ? rankAfter(lb, lEntry.player, lEntry.character, Math.max(100, le - lDelta)) : null;
        preview[s.id] = { elo: wDelta, rankW, rankL };
      }
      setModalPreview(preview);
    });
  }

  function closeScoreModal() {
    setScoreModalOpen(false);
    scoreModalKeyRef.current = null;
    setScoreModalA(null);
    setScoreModalB(null);
    setHoverPreview(null);
  }

  function hoverScore(p1s: number, p2s: number) {
    if (!scoreModalA || !scoreModalB) return;
    const isP1Win = p1s > p2s;
    const wk = Math.max(p1s, p2s);
    const lk = Math.min(p1s, p2s);
    const we = isP1Win ? modalElo.a : modalElo.b;
    const le = isP1Win ? modalElo.b : modalElo.a;
    const wEntry = isP1Win ? scoreModalA : scoreModalB;
    const lEntry = isP1Win ? scoreModalB : scoreModalA;
    const lb = lbCacheRef.current || [];
    const wCurRank = lb.length ? rankAfter(lb, wEntry.player, wEntry.character, we) : 999;
    const lCurRank = lb.length ? rankAfter(lb, lEntry.player, lEntry.character, le) : 999;
    const { winner: wDelta, loser: lDelta } = eloDeltas(we, le, wk, lk, wCurRank, lCurRank);
    const rankW = lb.length ? rankAfter(lb, wEntry.player, wEntry.character, we + wDelta) : null;
    const rankL = lb.length ? rankAfter(lb, lEntry.player, lEntry.character, Math.max(100, le - lDelta)) : null;
    setHoverPreview({
      p1Delta: isP1Win ? wDelta : -lDelta,
      p1Rank: isP1Win ? rankW : rankL,
      p2Delta: isP1Win ? -lDelta : wDelta,
      p2Rank: isP1Win ? rankL : rankW,
    });
  }

  function selectMobileWinner(side: 'p1' | 'p2') {
    setMobileWinner(side);
  }

  function advanceScoreModal(justFinishedKey: string) {
    const match = justFinishedKey.match(/^r(\d+)_m(\d+)$/);
    if (!match) {
      closeScoreModal();
      return;
    }
    const ri = parseInt(match[1], 10);
    const mi = parseInt(match[2], 10);
    const round = lastRenderedRoundsRef.current[ri];
    if (!round) {
      closeScoreModal();
      return;
    }
    for (let next = mi + 1; next < round.length; next++) {
      const [a, b] = round[next];
      if (!a || !b) continue;
      if (a === 'TBD' || b === 'TBD') continue;
      if (a.toUpperCase() === 'BYE' || b.toUpperCase() === 'BYE') continue;
      const roundWinners = dataRef.current?.round_winners || {};
      const nextKey = `r${ri}_m${next}`;
      if (roundWinners[nextKey]) continue;
      openScoreModal(a, b, nextKey);
      return;
    }
    closeScoreModal();
  }

  async function pickTournamentScore(p1Stocks: number, p2Stocks: number) {
    const key = scoreModalKeyRef.current;
    const a = scoreModalA;
    const b = scoreModalB;
    if (!key || !a || !b) return;
    const finishedKey = key;
    const wasDecided = !!dataRef.current?.round_winners?.[key];
    closeScoreModal();

    const winnerEntry = p1Stocks > p2Stocks ? a : b;
    const loserEntry = p1Stocks > p2Stocks ? b : a;
    const winnerKills = Math.max(p1Stocks, p2Stocks);
    const loserKills = Math.min(p1Stocks, p2Stocks);
    const winnerLabel = `${winnerEntry.player} — ${winnerEntry.character}`;
    const scoreStr = `${winnerKills}-${loserKills}`;

    // Computed straight from bracket_data.length (always current, since it's
    // read off dataRef -- the same source of truth every other bracket-state
    // check in this function already uses), not from lastRenderedRoundsRef,
    // which only reflects whatever `rounds` this component last rendered.
    // That ref is fine for UI purposes (advanceScoreModal's "what's the next
    // open match" walk), but using it here meant a correction/re-score, or
    // any path where the ref hadn't caught up to the latest bracket_data by
    // the moment this fired, could compute the wrong total round count and
    // silently miss the real Grand Final -- exactly how a completed bracket
    // can end up with a full round_winners map but no tournament_winner and
    // no placements. bracket_data.length is always a power of two (every
    // seeding path pads to one), so this is exact, not an approximation:
    // log2(N) halvings to reach the single final match, plus that final
    // round itself. Also fixes the 2-player case, where bracket_data has
    // exactly one match and that match *is* the Grand Final -- the old
    // `rounds.length > 1` guard excluded it outright.
    const bracketSize = dataRef.current?.bracket_data?.length || 0;
    const totalRounds = bracketSize > 0 ? Math.round(Math.log2(bracketSize)) + 1 : 0;
    const isGrandFinal = totalRounds > 0 && key === `r${totalRounds - 1}_m0`;

    try {
      if (wasDecided) {
        await apiDelete(`/brackets/${tournamentId}/result/${key}`);
      }
      const patchBody: Record<string, unknown> = { key, winner: winnerLabel, score: scoreStr };
      if (isGrandFinal) patchBody.tournament_winner = winnerEntry.player;
      await apiPatch(`/brackets/${tournamentId}/winner`, patchBody);

      // Always call /matches/record, even when winnerEntry.player ===
      // loserEntry.player (a free-pool self-match) -- the backend's own
      // guard (routers/matches.py's record_match) is the single shared place
      // that decides what a self-match does to Elo/stats, and it still logs
      // a MatchResult row (0 delta) so the match isn't invisible in history.
      // A frontend-side skip here used to bypass the backend call entirely,
      // which meant self-matches left no record at all -- exactly the kind
      // of per-call-site guard that was asked not to exist.
      await apiPost('/matches/record', {
        winner_username: winnerEntry.player,
        winner_char: winnerEntry.character,
        winner_kills: winnerKills,
        loser_username: loserEntry.player,
        loser_char: loserEntry.character,
        loser_kills: loserKills,
        bracket_id: parseInt(tournamentId!, 10),
        match_key: key,
      });
      Object.keys(eloCacheRef.current)
        .filter((k) => k.startsWith(winnerEntry.player + '/') || k.startsWith(loserEntry.player + '/'))
        .forEach((k) => delete eloCacheRef.current[k]);
      lbCacheRef.current = null;
      showUndoBtn(`${winnerEntry.player} (${winnerEntry.character})`, key, isGrandFinal);
      await fetchAndRender();
      if (!wasDecided) advanceScoreModal(finishedKey);
    } catch (err) {
      showToast('Error recording score: ' + (err as Error).message, 'error');
    }
  }

  // ── Undo bar ──────────────────────────────────────────────────────────────
  function showUndoBtn(label: string, matchKey: string, isGrandFinal = false) {
    if (!canRecord) return;
    undoMatchKeyRef.current = matchKey;
    undoIsGrandFinalRef.current = isGrandFinal;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    setUndoLabel(label);
    let remaining = 30;
    setUndoCountdown(remaining);
    undoIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setUndoCountdown(remaining);
      if (remaining <= 0 && undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    }, 1000);
    undoTimerRef.current = setTimeout(() => {
      setUndoLabel(null);
      undoMatchKeyRef.current = null;
      // Undo window closed without being used -- if that match was the Grand
      // Final, the tournament is done and nothing can still correct it here,
      // so wrap it up automatically instead of leaving it sitting live.
      if (undoIsGrandFinalRef.current) {
        undoIsGrandFinalRef.current = false;
        endTournamentNow();
      }
    }, 30000);
  }

  async function undoLastScore() {
    if (!undoMatchKeyRef.current) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    undoIsGrandFinalRef.current = false;
    try {
      const res = await apiDelete<{ undone?: string }>(`/brackets/${tournamentId}/result/${undoMatchKeyRef.current}`);
      showToast(`Undid: ${res.undone || 'result'}`, 'success');
      setUndoLabel(null);
      undoMatchKeyRef.current = null;
      await fetchAndRender();
    } catch (err) {
      showToast('Nothing to undo or error: ' + (err as Error).message, 'error');
    }
  }

  // ── Character edit picker ────────────────────────────────────────────────
  async function selectChar(newChar: string) {
    if (!charPickerOldChar || !newChar) return;
    const oldChar = charPickerOldChar;
    setCharPickerOldChar(null);
    try {
      await apiPatch(`/brackets/${tournamentId}/my-character`, { old_char: oldChar, new_char: newChar });
      showToast(`Character updated to ${newChar}!`, 'success');
      await fetchAndRender();
    } catch (err) {
      showToast('Could not update character: ' + (err as Error).message, 'error');
    }
  }

  // ── End tournament ────────────────────────────────────────────────────────
  async function endTournamentNow() {
    setEndModalOpen(false);
    try {
      const result = await apiPatch<{ bonuses?: { place: string; player: string; char: string; bonus: number }[] }>(`/brackets/${tournamentId}/end`, {});
      const bonuses = result.bonuses || [];
      if (bonuses.length > 0) {
        const lines = bonuses.map((b) => `${b.place}: ${b.player} (${b.char}) +${b.bonus} Elo`).join(' · ');
        showToast(`Tournament ended! Placement bonuses — ${lines}`, 'success');
      } else {
        showToast('Tournament ended. All recorded stats are saved.', 'success');
      }
      await fetchAndRender();
    } catch (err) {
      showToast('Error ending tournament: ' + (err as Error).message, 'error');
    }
  }

  // ── Derived render data ──────────────────────────────────────────────────
  const rounds = data?.bracket_data?.length ? computeRounds(data.bracket_data, data.round_winners || {}) : [];
  lastRenderedRoundsRef.current = rounds;

  if (loading) {
    return (
      <PageContainer>
        <div id="loading" className="loading-center">
          <div className="spinner" />
          <span>Loading tournament…</span>
        </div>
      </PageContainer>
    );
  }

  if (errored || !data) {
    return (
      <PageContainer>
        <div className="empty-state">
          <p>Tournament not found or you don&apos;t have access.</p>
          <Link href="/invites" className="btn btn-outline btn-sm" style={{ marginTop: 12 }}>
            Back to Invites
          </Link>
        </div>
      </PageContainer>
    );
  }

  const hasBracket = data.bracket_data && data.bracket_data.length > 0;
  // Mirrors routers/brackets.py's _placement_bonus_k exactly -- 8 points per
  // round survived (log2 of the padded entry count), not a flat multiple of
  // player count. bracket_data.length is round-1 MATCHES (padded entries /
  // 2), always a power of two, so no separate bye-padding handling is
  // needed here either. Keep both in sync if the formula changes again.
  const bracketSize = data.bracket_data?.length || 0;
  const totalRounds = bracketSize > 0 ? Math.round(Math.log2(bracketSize)) + 1 : 0;
  const tK = 8 * totalRounds;

  return (
    <PageContainer>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h1>{data.name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Hosted by {data.host}</p>
        </div>
        <div>
          {data.is_live ? (
            <div className="live-badge">
              <span className="live-dot" /> LIVE
            </div>
          ) : (
            <div className="ended-badge">Ended</div>
          )}
        </div>
        {hasBracket && (
          <div style={{ display: 'flex', background: 'rgba(255,224,102,0.07)', border: '1px solid rgba(255,224,102,0.2)', borderRadius: 8, padding: '7px 14px', fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 1 }}>Elo Rewards</span>
            <span>
              🥇 <span style={{ color: '#ffe066' }}>+{tK}</span>
            </span>
            <span>
              🥈 <span style={{ color: '#c0c0c0' }}>+{Math.round(tK * 0.5)}</span>
            </span>
            <span>
              🥉 <span style={{ color: '#cd7f32' }}>+{Math.round(tK * 0.25)}</span>
            </span>
          </div>
        )}
        {isHost && data.is_live && (
          <button
            type="button"
            onClick={() => setEndModalOpen(true)}
            style={{ display: 'block', marginLeft: 'auto', background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c', borderRadius: 6, padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
          >
            End Tournament
          </button>
        )}
      </div>

      {hasBracket && (
        <div style={{ marginBottom: 14 }}>
          <SurvivorStrip
            bracketData={data.bracket_data}
            roundWinners={data.round_winners || {}}
            players={data.players}
            charsPerPlayer={data.chars_per_player || 1}
          />
        </div>
      )}

      {data.is_live && !hasBracket ? (
        <LineupPhase
          data={data}
          myUsername={myUsername}
          isHost={isHost}
          lineupSlots={lineupSlots}
          favChars={favChars}
          confirmed={confirmed}
          onQuickPick={quickPickChar}
          onSelectSlot={selectLineupChar}
          onConfirm={confirmLineup}
          bracketOpts={bracketOpts}
          onBracketOptsChange={setBracketOpts}
          onPreview={previewMatchups}
          previewLoading={previewLoading}
          previewPairs={previewPairs}
          previewSwapMode={previewSwapMode}
          previewSwapSel={previewSwapSel}
          onToggleSwap={toggleMatchupSwap}
          onSwapClick={handlePreviewSwap}
          onConfirmMatchups={confirmMatchups}
        />
      ) : (
        <BracketPhase
          data={data}
          rounds={rounds}
          myUsername={myUsername}
          isHost={isHost}
          canRecord={canRecord}
          badges={badges}
          liveSwapMode={liveSwapMode}
          liveSwapSel={liveSwapSel}
          onToggleLiveSwap={toggleLiveSwap}
          onLiveSwapClick={handleLiveSwapClick}
          onOpenScoreModal={openScoreModal}
          onOpenCharPicker={setCharPickerOldChar}
        />
      )}

      {undoLabel && (
        <div style={{ display: 'flex', marginTop: 14, alignItems: 'center', gap: 12, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>
            Last score: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{undoLabel}</span>
          </span>
          <button
            type="button"
            onClick={undoLastScore}
            style={{ background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c', borderRadius: 6, padding: '5px 14px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Undo ({undoCountdown}s)
          </button>
        </div>
      )}

      {hasBracket && (
        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: data.is_live ? '#27ae60' : '#e74c3c', display: 'inline-block', animation: data.is_live ? 'pulse 2s ease-in-out infinite' : 'none', flexShrink: 0 }} />
          <span>{data.is_live ? 'Live · syncing every 5s' : 'Tournament ended'}</span>
        </div>
      )}

      {scoreModalOpen && scoreModalA && scoreModalB && (
        <ScoreModal
          a={scoreModalA}
          b={scoreModalB}
          canRecord={canRecord}
          modalElo={modalElo}
          modalPreview={modalPreview}
          hoverPreview={hoverPreview}
          mobileWinner={mobileWinner}
          badges={badges}
          getAvatar={(u: string) => getPlayerAvatar(allUserAvatarsRef.current, u)}
          onClose={closeScoreModal}
          onHover={hoverScore}
          onHoverReset={() => setHoverPreview(null)}
          onSelectMobileWinner={selectMobileWinner}
          onPick={pickTournamentScore}
        />
      )}

      {endModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid rgba(231,76,60,0.4)', borderRadius: 14, padding: '28px 24px', width: 360, maxWidth: '95vw', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 8 }}>End Tournament Early?</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 24 }}>
              The tournament will be marked as ended. All stats recorded so far (kills, wins, losses) are already saved and will not be affected.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => setEndModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={{ flex: 1, background: '#e74c3c', color: '#fff', border: 'none', borderRadius: 7, padding: 9, fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer' }} onClick={endTournamentNow}>
                Yes, End It
              </button>
            </div>
          </div>
        </div>
      )}

      {charPickerOldChar !== null && (
        <div
          id="charPickerModal"
          className="open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCharPickerOldChar(null);
          }}
        >
          <div className="char-picker-box">
            <h3>Pick your character</h3>
            <input
              type="text"
              placeholder="Search…"
              autoComplete="off"
              autoFocus
              value={charPickerSearch}
              onChange={(e) => setCharPickerSearch(e.target.value)}
            />
            <div className="char-list">
              {SMASH_ROSTER.filter((c) => !charPickerSearch || c.toLowerCase().includes(charPickerSearch.toLowerCase())).map((c) => (
                <div
                  key={c}
                  className="char-list-item"
                  onClick={() => {
                    selectChar(c);
                    setCharPickerSearch('');
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
            <div className="char-picker-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setCharPickerOldChar(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

// ── Lineup phase ────────────────────────────────────────────────────────────
function LineupPhase({
  data,
  myUsername,
  isHost,
  lineupSlots,
  favChars,
  confirmed,
  onQuickPick,
  onSelectSlot,
  onConfirm,
  bracketOpts,
  onBracketOptsChange,
  onPreview,
  previewLoading,
  previewPairs,
  previewSwapMode,
  previewSwapSel,
  onToggleSwap,
  onSwapClick,
  onConfirmMatchups,
}: {
  data: BracketData;
  myUsername: string;
  isHost: boolean;
  lineupSlots: string[];
  favChars: string[];
  confirmed: boolean;
  onQuickPick: (c: string) => void;
  onSelectSlot: (slot: number, c: string) => void;
  onConfirm: () => void;
  bracketOpts: BracketOptionsValue;
  onBracketOptsChange: (v: BracketOptionsValue) => void;
  onPreview: () => void;
  previewLoading: boolean;
  previewPairs: { a: string; b: string }[] | null;
  previewSwapMode: boolean;
  previewSwapSel: { pairIdx: number; slot: 0 | 1 } | null;
  onToggleSwap: () => void;
  onSwapClick: (pairIdx: number, slot: 0 | 1) => void;
  onConfirmMatchups: () => void;
}) {
  const confirmedLineups = data.confirmed_lineups || {};
  const players = data.players || [];
  const taken = new Set(lineupSlots.filter(Boolean));

  return (
    <div>
      {isHost && (
        <div style={{ display: 'flex', background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: '#27ae60', fontWeight: 600 }}>Share link with players:</span>
          <input
            readOnly
            value={typeof window !== 'undefined' ? window.location.href : ''}
            style={{ flex: 1, minWidth: 200, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(39,174,96,0.35)', color: '#ccc', borderRadius: 4, padding: '3px 8px', fontSize: '0.8rem' }}
          />
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                navigator.clipboard.writeText(window.location.href).then(() => showToast('Link copied!', 'success'));
              }
            }}
            style={{ background: 'rgba(39,174,96,0.2)', border: '1px solid rgba(39,174,96,0.4)', color: '#27ae60', borderRadius: 4, padding: '3px 10px', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Copy
          </button>
        </div>
      )}

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 4 }}>Pick Your Characters</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>Choose your characters then confirm your lineup.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {favChars.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>Favourites:</span>
              {favChars.map((c) => {
                const url = charImgUrl(c);
                const used = taken.has(c);
                return url ? (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => onQuickPick(c)}
                    style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: 3, cursor: 'pointer', lineHeight: 0, flexShrink: 0, opacity: used ? 0.35 : 1, pointerEvents: used ? 'none' : undefined }}
                  >
                    <img src={url} alt={c} style={{ width: 30, height: 30, objectFit: 'contain' }} onError={(e) => ((e.target as HTMLImageElement).parentElement!.style.display = 'none')} />
                  </button>
                ) : (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onQuickPick(c)}
                    style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text)', opacity: used ? 0.35 : 1, pointerEvents: used ? 'none' : undefined }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}

          {lineupSlots.map((val, i) => (
            <LineupSlot key={i} slotIdx={i} value={val} allValues={lineupSlots} onSelect={onSelectSlot} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmed ? 'Update Lineup' : 'Confirm Lineup'}
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{confirmed ? '✅ Confirmed' : ''}</span>
        </div>
      </div>

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 14 }}>Player Status</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {players.map((p) => {
            const chars = confirmedLineups[p];
            const done = chars && chars.length > 0;
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--card-bg2)', borderRadius: 8, border: `1px solid ${done ? 'rgba(39,174,96,0.3)' : 'var(--border)'}` }}>
                <span style={{ fontSize: '1rem' }}>{done ? '✅' : ''}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{p}</span>
                {done ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    {chars.map((c) => {
                      const url = charImgUrl(c);
                      return url ? (
                        <img key={c} src={url} alt={c} title={c} style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4, background: 'var(--card-bg)' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                      ) : (
                        <span key={c} style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {c}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#27ae60', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                    Waiting…
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isHost && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 'var(--radius)', padding: 20 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-gold)', marginBottom: 8 }}>Ready to generate?</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 14 }}>Players who haven&apos;t confirmed will get a BYE. You can edit matchups before locking in.</p>

          <div style={{ marginBottom: 16 }}>
            <BracketOptionsPicker value={bracketOpts} onChange={onBracketOptsChange} />
          </div>

          <button type="button" className="btn btn-gold" onClick={onPreview} disabled={previewLoading}>
            {previewLoading ? '⏳ Computing…' : '👁 Preview Matchups'}
          </button>

          {previewPairs && (
            <div style={{ marginTop: 16, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Matchup Preview</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={`btn btn-outline btn-sm${previewSwapMode ? ' active' : ''}`} onClick={onToggleSwap}>
                    {previewSwapMode ? '✅ Done Editing' : '✏️ Edit Matchups'}
                  </button>
                  <button type="button" className="btn btn-gold btn-sm" onClick={onConfirmMatchups}>
                    ✅ Confirm &amp; Generate
                  </button>
                </div>
              </div>
              {previewSwapMode && (
                <div style={{ background: 'rgba(0,119,200,0.12)', border: '1px solid rgba(0,119,200,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: 'var(--accent-blue)', marginBottom: 12 }}>
                  Swap mode ON — click any entry to select it, then click another to swap.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
                {previewPairs.map((pair, pi) => (
                  <div key={pi} className="match-box">
                    {([0, 1] as const).map((slot) => {
                      const val = slot === 0 ? pair.a : pair.b;
                      const isBye = !val || val === 'BYE';
                      const isSel = previewSwapSel && previewSwapSel.pairIdx === pi && previewSwapSel.slot === slot;
                      let cls = isBye ? ' bye' : '';
                      if (!isBye && previewSwapMode) cls += isSel ? ' swap-selected' : ' swap-hover';
                      const charName = val && val.includes(' — ') ? val.split(' — ')[1] : '';
                      const imgUrl = charName ? charHeadUrl(charName) : null;
                      return (
                        <div
                          key={slot}
                          className={`match-entry${cls}`}
                          onClick={!isBye && previewSwapMode ? () => onSwapClick(pi, slot) : undefined}
                        >
                          {imgUrl && <img className="match-char-icon" src={imgUrl} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isBye ? 'BYE' : val}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LineupSlot({ slotIdx, value, allValues, onSelect }: { slotIdx: number; value: string; allValues: string[]; onSelect: (slot: number, c: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const taken = new Set(allValues.filter((c, i) => c && i !== slotIdx));
  const q = text.toLowerCase();
  const matches = SMASH_ROSTER.filter((c) => (!q || c.toLowerCase().includes(q)) && !taken.has(c));

  function pick(c: string) {
    setText(c);
    setOpen(false);
    onSelect(slotIdx, c);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Slot {slotIdx + 1}</span>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          type="text"
          placeholder="— Search character —"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          style={{ width: '100%', padding: '7px 10px', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: '0.88rem', boxSizing: 'border-box' }}
        />
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, zIndex: 50, maxHeight: 180, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            {matches.length ? (
              matches.map((c) => (
                <div key={c} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '0.85rem', color: '#e8edf3' }} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
                  {c}
                </div>
              ))
            ) : (
              <div style={{ padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>No match</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bracket phase ────────────────────────────────────────────────────────────
function BracketPhase({
  data,
  rounds,
  myUsername,
  isHost,
  canRecord,
  badges,
  liveSwapMode,
  liveSwapSel,
  onToggleLiveSwap,
  onLiveSwapClick,
  onOpenScoreModal,
  onOpenCharPicker,
}: {
  data: BracketData;
  rounds: [string | null, string | null][][];
  myUsername: string;
  isHost: boolean;
  canRecord: boolean;
  badges: BadgeMap;
  liveSwapMode: boolean;
  liveSwapSel: number | null;
  onToggleLiveSwap: () => void;
  onLiveSwapClick: (pos: number) => void;
  onOpenScoreModal: (a: string, b: string, key: string) => void;
  onOpenCharPicker: (oldChar: string) => void;
}) {
  const roundWinners = data.round_winners || {};
  const roundScores = data.round_scores || {};
  // The SurvivorStrip above renders exactly when chars_per_player > 1, and
  // shows the same player names plus survivor counts -- this row is the
  // inverse of that condition, so the roster shows up in exactly one place:
  // the strip when it's up (chars_per_player > 1), these plain chips when
  // it's not (chars_per_player == 1, where the strip is hidden and this is
  // the only place the roster appears at all).
  const showPlayersChips = (data.chars_per_player || 1) <= 1;

  return (
    <div>
      {(showPlayersChips || (isHost && data.is_live)) && (
        <div style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {showPlayersChips && (
            <>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Players:</span>
              {(data.players || []).map((p) => (
                <span key={p} style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', fontSize: '0.82rem', color: 'var(--text)' }}>
                  {p}
                </span>
              ))}
            </>
          )}
          {isHost && data.is_live && (
            <button type="button" className={`btn btn-outline btn-sm${liveSwapMode ? ' active' : ''}`} onClick={onToggleLiveSwap} style={{ marginLeft: 'auto' }}>
              {liveSwapMode ? '✅ Done Swapping' : '🔀 Swap Matchup'}
            </button>
          )}
        </div>
      )}

      {liveSwapMode && (
        <div style={{ background: 'rgba(0,119,200,0.12)', border: '1px solid rgba(0,119,200,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: 'var(--accent-blue)', marginBottom: 12 }}>
          Swap mode ON — tap one Round 1 entry, then another, to swap them. Resolved matches are dimmed and can&apos;t be swapped.
        </div>
      )}

      <div className="bracket-rounds">
        {rounds.map((round, ri) => (
          <div key={ri} className="round-col">
            <div className="round-title">{roundName(ri, rounds.length)}</div>
            {round.map(([a, b], mi) => {
              const key = `r${ri}_m${mi}`;
              const isByeMatch = (!!a && a.toUpperCase() === 'BYE') || (!!b && b.toUpperCase() === 'BYE');
              const validMatch = !!a && !!b && a !== 'TBD' && b !== 'TBD' && a.toUpperCase() !== 'BYE' && b.toUpperCase() !== 'BYE';
              return (
                <div
                  key={mi}
                  className={`match-box${data.is_live && validMatch ? ' clickable' : ''}`}
                  onClick={
                    data.is_live && validMatch
                      ? (e) => {
                          if ((e.target as HTMLElement).closest('.edit-char-btn')) return;
                          if (liveSwapMode) return;
                          onOpenScoreModal(a!, b!, key);
                        }
                      : undefined
                  }
                >
                  <MatchEntry label={a} roundWinners={roundWinners} roundScores={roundScores} isLive={data.is_live} roundIdx={ri} matchKey={key} mode={data.mode} mi={mi} slotIdx={0} isByeMatch={isByeMatch} myUsername={myUsername} liveSwapMode={liveSwapMode} liveSwapSel={liveSwapSel} isHost={isHost} badges={badges} onLiveSwapClick={onLiveSwapClick} onOpenCharPicker={onOpenCharPicker} />
                  <MatchEntry label={b} roundWinners={roundWinners} roundScores={roundScores} isLive={data.is_live} roundIdx={ri} matchKey={key} mode={data.mode} mi={mi} slotIdx={1} isByeMatch={isByeMatch} myUsername={myUsername} liveSwapMode={liveSwapMode} liveSwapSel={liveSwapSel} isHost={isHost} badges={badges} onLiveSwapClick={onLiveSwapClick} onOpenCharPicker={onOpenCharPicker} />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {data.winner && !data.is_live && (
        <div style={{ marginTop: 20, background: 'linear-gradient(135deg,rgba(255,215,0,0.15),rgba(255,165,0,0.08))', border: '1.5px solid rgba(255,215,0,0.5)', borderRadius: 12, padding: '20px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 6 }}>🏆</div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,215,0,0.7)', marginBottom: 4 }}>Tournament Champion</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#ffd700', textTransform: 'uppercase', letterSpacing: 1 }}>{data.winner}</div>
        </div>
      )}
    </div>
  );
}

function MatchEntry({
  label,
  roundWinners,
  roundScores,
  isLive,
  roundIdx,
  matchKey,
  mode,
  mi,
  slotIdx,
  isByeMatch,
  myUsername,
  liveSwapMode,
  liveSwapSel,
  isHost,
  badges,
  onLiveSwapClick,
  onOpenCharPicker,
}: {
  label: string | null;
  roundWinners: Record<string, string>;
  roundScores: Record<string, string>;
  isLive: boolean;
  roundIdx: number;
  matchKey: string;
  mode: string | null;
  mi: number;
  slotIdx: 0 | 1;
  isByeMatch: boolean;
  myUsername: string;
  liveSwapMode: boolean;
  liveSwapSel: number | null;
  isHost: boolean;
  badges: BadgeMap;
  onLiveSwapClick: (pos: number) => void;
  onOpenCharPicker: (oldChar: string) => void;
}) {
  const winnerLabel = roundWinners[matchKey];
  const pos = mi * 2 + slotIdx;
  // Matches B2's server-side guard: swappable if round 1, host, live-swap mode
  // is on, and this match has no *real* recorded result -- a bye's
  // auto-resolved round_winners entry doesn't count.
  const canLiveSwap = liveSwapMode && isHost && isLive && roundIdx === 0 && (!winnerLabel || isByeMatch);
  const isSel = liveSwapSel === pos;

  if (!label || label === 'TBD') return <div className="match-entry bye">— TBD —</div>;

  const isBye = label.toUpperCase() === 'BYE';
  if (isBye) {
    if (canLiveSwap) {
      return (
        <div className={`match-entry bye${isSel ? ' swap-selected' : ' swap-hover'}`} onClick={() => onLiveSwapClick(pos)}>
          BYE
        </div>
      );
    }
    return <div className={`match-entry bye${liveSwapMode ? ' swap-disabled' : ''}`}>BYE</div>;
  }

  const isWinner = winnerLabel === label;
  const isLoser = !!winnerLabel && winnerLabel !== label;
  const isMe = !!myUsername && label.startsWith(myUsername + ' — ');
  const myChar = isMe ? label.slice(myUsername.length + 3) : null;
  const parsed = parseLabel(label);
  const charName = parsed ? parsed.character : '';
  const iconUrl = charName ? charHeadUrl(charName) : null;
  const score = roundScores[matchKey];

  const canEdit = isMe && isLive && roundIdx === 0 && !winnerLabel && mode !== 'draft' && !liveSwapMode;
  const swapCls = canLiveSwap ? (isSel ? ' swap-selected' : ' swap-hover') : liveSwapMode ? ' swap-disabled' : '';
  const cls = `match-entry${isWinner ? ' winner' : ''}${isMe ? ' mine' : ''}${swapCls}`;

  return (
    <div className={cls} style={isLoser ? { opacity: 0.45 } : undefined} onClick={canLiveSwap ? () => onLiveSwapClick(pos) : undefined}>
      {iconUrl && <img className="match-char-icon" src={iconUrl} alt={charName} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      {parsed && <BadgePill badges={badges} username={parsed.player} />}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {isWinner && score && (
        <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ffe066', background: 'rgba(255,224,102,0.12)', border: '1px solid rgba(255,224,102,0.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{score}</span>
      )}
      {canEdit && myChar && (
        <button
          type="button"
          className="edit-char-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCharPicker(myChar);
          }}
        >
          ✏️
        </button>
      )}
    </div>
  );
}

// ── Score modal (full VS screen) ─────────────────────────────────────────────
function ScoreModal({
  a,
  b,
  canRecord,
  modalElo,
  modalPreview,
  hoverPreview,
  mobileWinner,
  badges,
  getAvatar,
  onClose,
  onHover,
  onHoverReset,
  onSelectMobileWinner,
  onPick,
}: {
  a: { player: string; character: string };
  b: { player: string; character: string };
  canRecord: boolean;
  modalElo: { a: number; b: number };
  modalPreview: Record<string, { elo: number; rankW: number | null; rankL: number | null }>;
  hoverPreview: { p1Delta: number; p1Rank: number | null; p2Delta: number; p2Rank: number | null } | null;
  mobileWinner: 'p1' | 'p2' | null;
  badges: BadgeMap;
  getAvatar: (username: string) => string;
  onClose: () => void;
  onHover: (p1s: number, p2s: number) => void;
  onHoverReset: () => void;
  onSelectMobileWinner: (side: 'p1' | 'p2') => void;
  onPick: (p1s: number, p2s: number) => void;
}) {
  const av1 = getAvatar(a.player);
  const av2 = getAvatar(b.player);
  const p1Img = charImgUrl(a.character);
  const p2Img = charImgUrl(b.character);

  // Free-pool draft brackets can pit two of the same real player's entries
  // (different characters) against each other from the quarterfinals on --
  // by design, not a seeding bug (see _deal_bracket in routers/draft.py).
  // The backend guard (routers/matches.py's record_match) already zeroes the
  // Elo/stat effect for this case; the modal needs its own awareness so it
  // doesn't show two identical "<player> WINS" columns, a hover Elo preview
  // that would be wrong once picked, and rank arrows that mean nothing here.
  const isSelfMatch = a.player === b.player;

  const p1EloDisplay = isSelfMatch ? null : hoverPreview ? (
    <span style={{ color: hoverPreview.p1Delta >= 0 ? '#4caf50' : '#e74c3c', fontSize: '1.15em', fontWeight: 900 }}>
      {hoverPreview.p1Delta >= 0 ? '+' : '−'}
      {Math.abs(hoverPreview.p1Delta)}
      {hoverPreview.p1Rank != null && <span style={{ fontSize: '0.8em' }}> → #{hoverPreview.p1Rank}</span>}
    </span>
  ) : (
    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78em' }}>{modalElo.a} elo</span>
  );
  const p2EloDisplay = isSelfMatch ? null : hoverPreview ? (
    <span style={{ color: hoverPreview.p2Delta >= 0 ? '#4caf50' : '#e74c3c', fontSize: '1.15em', fontWeight: 900 }}>
      {hoverPreview.p2Delta >= 0 ? '+' : '−'}
      {Math.abs(hoverPreview.p2Delta)}
      {hoverPreview.p2Rank != null && <span style={{ fontSize: '0.8em' }}> → #{hoverPreview.p2Rank}</span>}
    </span>
  ) : (
    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78em' }}>{modalElo.b} elo</span>
  );

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
    <div id="scoreModal" className="open">
      <div className="vs-bg">
        <div className="vs-bg-left">
          <img src={av1} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
        </div>
        <div className="vs-bg-right">
          <img src={av2} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
        </div>
        <div className="vs-bg-center" />
        <div className="vs-lightning" />
      </div>

      <button type="button" className="vs-close" onClick={onClose}>
        ✕ Close
      </button>

      <div className="vs-content">
        <div className="vs-player p1-side">
          {p1Img && <img className="vs-char-img" src={p1Img} alt="" />}
          <div className="vs-player-info">
            <div className="vs-player-tag p1">P1</div>
            <img className="vs-avatar" src={av1} alt="P1" />
            <div className="vs-name p1">
              {a.player} <BadgePill badges={badges} username={a.player} />
            </div>
            <div className="vs-char-name">{a.character}</div>
            <div className="vcp-elo-display">{p1EloDisplay}</div>
          </div>
        </div>

        <div className="vs-middle">
          <div className="vs-logo">Super Smash Bros. Ultimate</div>
          <div className="vs-text">VS</div>

          <div className="vs-center-panel">
            {!canRecord && (
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginBottom: 8 }}>
                Spectating — host picks score
              </div>
            )}
            {isSelfMatch ? (
              // Both entries are the same real player -- there's no elo/rank
              // stake in this match (the backend already zeroes it), so
              // there's nothing to score. Advancing one character is the
              // only decision left; no hover preview, no rank arrows.
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <button
                  type="button"
                  className="vcp-btn vcp-p1"
                  style={canRecord ? { flex: 1, padding: '10px 14px' } : { flex: 1, padding: '10px 14px', pointerEvents: 'none', opacity: 0.7, cursor: 'default' }}
                  onClick={() => onPick(3, 0)}
                >
                  Advance {a.character}
                </button>
                <button
                  type="button"
                  className="vcp-btn vcp-p2"
                  style={canRecord ? { flex: 1, padding: '10px 14px' } : { flex: 1, padding: '10px 14px', pointerEvents: 'none', opacity: 0.7, cursor: 'default' }}
                  onClick={() => onPick(0, 3)}
                >
                  Advance {b.character}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <div className="vcp-section">
                  <div className="vcp-label vcp-p1-label">{a.player} WINS</div>
                  <div className="vcp-btns">
                    {p1Scenarios.map((s) => (
                      <button
                        key={s.id}
                        className="vcp-btn vcp-p1"
                        style={canRecord ? undefined : { pointerEvents: 'none', opacity: 0.7, cursor: 'default' }}
                        onMouseOver={() => onHover(s.wk, s.lk)}
                        onMouseOut={onHoverReset}
                        onClick={() => onPick(s.wk, s.lk)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ width: 1, background: 'rgba(255,255,255,0.18)', alignSelf: 'stretch', flexShrink: 0 }} />
                <div className="vcp-section">
                  <div className="vcp-label vcp-p2-label">{b.player} WINS</div>
                  <div className="vcp-btns">
                    {p2Scenarios.map((s) => (
                      <button
                        key={s.id}
                        className="vcp-btn vcp-p2"
                        style={canRecord ? undefined : { pointerEvents: 'none', opacity: 0.7, cursor: 'default' }}
                        onMouseOver={() => onHover(s.lk, s.wk)}
                        onMouseOut={onHoverReset}
                        onClick={() => onPick(s.lk, s.wk)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="vs-player p2-side">
          {p2Img && <img className="vs-char-img" src={p2Img} alt="" />}
          <div className="vs-player-info">
            <div className="vs-player-tag p2">P2</div>
            <img className="vs-avatar" src={av2} alt="P2" />
            <div className="vs-name p2">
              {b.player} <BadgePill badges={badges} username={b.player} />
            </div>
            <div className="vs-char-name">{b.character}</div>
            <div className="vcp-elo-display">{p2EloDisplay}</div>
          </div>
        </div>
      </div>

      <div className="vs-winner-row">
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)', marginBottom: 8, display: canRecord ? '' : 'none' }}>
          {isSelfMatch ? 'Advance a Character' : 'Pick Score (stocks)'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 8, display: canRecord ? 'none' : '' }}>Only the host can record results</div>

        {/* Mobile winner-first picker -- id kept as the legacy #mobileScorePicker
            so style.css's existing portrait-mobile media query (which shows
            this and hides everything else in .vs-winner-row) still applies
            unchanged. The legacy page's #desktopScoreGrid sibling is not
            ported -- it was dead in every viewport (see CLAUDE.md Known
            Gaps): hidden by inline style on desktop with nothing to un-hide
            it, and explicitly forced hidden again on portrait mobile. Desktop
            scoring uses only the compact vcp-btn buttons above, with the
            hover Elo preview next to each player's name. */}
        {/* Inline display:none matches the legacy default -- style.css's
            portrait-mobile media query is what un-hides this (!important),
            same as the original markup; without this base style it would
            show on every viewport, not just portrait mobile. */}
        <div id="mobileScorePicker" style={{ display: 'none' }}>
          {isSelfMatch ? (
            // Same "no elo/rank stake" reasoning as the desktop branch above --
            // just the two characters to advance, no winner-then-score flow.
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="m-win-btn m-win-p1"
                style={canRecord ? undefined : { cursor: 'default', opacity: 0.45, pointerEvents: 'none' }}
                onClick={() => onPick(3, 0)}
              >
                <span>Advance {a.character}</span>
              </button>
              <button
                type="button"
                className="m-win-btn m-win-p2"
                style={canRecord ? undefined : { cursor: 'default', opacity: 0.45, pointerEvents: 'none' }}
                onClick={() => onPick(0, 3)}
              >
                <span>Advance {b.character}</span>
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                <button type="button" className={`m-win-btn m-win-p1${mobileWinner === 'p1' ? ' active' : ''}`} onClick={() => onSelectMobileWinner('p1')}>
                  <span>{a.player} WON</span>
                </button>
                <button type="button" className={`m-win-btn m-win-p2${mobileWinner === 'p2' ? ' active' : ''}`} onClick={() => onSelectMobileWinner('p2')}>
                  <span>{b.player} WON</span>
                </button>
              </div>
              {mobileWinner && (
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>Pick score</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {(mobileWinner === 'p1' ? p1Scenarios : p2Scenarios).map((s) => {
                      const prev = modalPreview[s.id];
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className="m-score-card"
                          style={canRecord ? undefined : { cursor: 'default', opacity: 0.45, pointerEvents: 'none' }}
                          onClick={() => (mobileWinner === 'p1' ? onPick(s.wk, s.lk) : onPick(s.lk, s.wk))}
                        >
                          <div className="m-score-name">{s.label}</div>
                          {prev && (prev.rankW != null || prev.rankL != null) && (
                            <div className="m-rank-row">
                              <span style={{ color: '#4caf50' }}>{prev.rankW != null ? `↑#${prev.rankW}` : ''}</span>
                              <span style={{ color: '#e74c3c' }}>{prev.rankL != null ? `↓#${prev.rankL}` : ''}</span>
                            </div>
                          )}
                          {prev && <div className="m-elo-val">{`+${prev.elo}`}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
