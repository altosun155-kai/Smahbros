// Shared mocking helpers for the draft-pick state-machine tests. Every API
// call the draft room page makes is intercepted client-side via page.route()
// before it leaves the browser -- there's no real backend in this pass (per
// the scoping decision: mocked-API tests only, no Supabase, no FastAPI, no
// fixtures). page.route() intercepts at the browser's network layer, before
// Next's server-side rewrite would even run, so the real proxy target
// (production, by default, if API_PROXY_TARGET isn't set for this dev
// server) is never actually reached regardless.
import type { Page, Route } from '@playwright/test';

export interface MockDraftPick {
  slot_index: number;
  character: string | null;
  locked: boolean;
}

export interface MockRoom {
  id: number;
  status: 'lobby' | 'picking' | 'revealed' | 'live' | 'closed';
  host_id: number;
  num_players: number;
  chars_per_player: number;
  players: { id: number; username: string; avatar_url: string | null }[];
  picks: Record<string, MockDraftPick[]>;
  bracket_id: number | null;
  bracket_ids: number[];
  created_at: string;
}

// A room with N empty slots for the given player ids, defaulting to a
// 2-player room -- override individual picks via `picksOverride`.
export function makeRoom(opts: {
  id?: number;
  status?: MockRoom['status'];
  chars_per_player?: number;
  playerIds?: number[];
  picksOverride?: Record<string, MockDraftPick[]>;
}): MockRoom {
  const id = opts.id ?? 1;
  const chars = opts.chars_per_player ?? 4;
  const playerIds = opts.playerIds ?? [1, 2];
  const emptySlots = (): MockDraftPick[] =>
    Array.from({ length: chars }, (_, i) => ({ slot_index: i, character: null, locked: false }));
  const picks: Record<string, MockDraftPick[]> = {};
  for (const pid of playerIds) picks[String(pid)] = emptySlots();
  if (opts.picksOverride) Object.assign(picks, opts.picksOverride);
  return {
    id,
    status: opts.status ?? 'picking',
    host_id: playerIds[0],
    num_players: playerIds.length,
    chars_per_player: chars,
    players: playerIds.map((pid) => ({ id: pid, username: pid === 1 ? 'alice' : `player${pid}`, avatar_url: null })),
    picks,
    bracket_id: null,
    bracket_ids: [],
    created_at: new Date().toISOString(),
  };
}

// Sets localStorage before any page script runs -- AuthGate's useAuthGuard
// only checks getToken() synchronously, no API call, so a fake token is
// sufficient (never validated against a real backend in this pass).
export async function mockAuth(page: Page, username = 'alice') {
  await page.addInitScript((u) => {
    localStorage.setItem('authToken', 'fake-test-token');
    localStorage.setItem('username', u);
  }, username);
}

// One catch-all handler for every /api/* call the app makes while a draft
// room page is mounted (AuthGate/AppShell's own /health and /users/me
// included) -- anything not explicitly recognized gets a harmless empty 200
// rather than falling through to a real network call, since page.route()
// only intercepts patterns it's given and this repo's default proxy target
// is production.
export async function mockDraftApis(
  page: Page,
  opts: {
    room: MockRoom;
    onPick?: (route: Route) => Promise<void> | void;
    // Explicit, so a test can name exactly which characters appear in the
    // top-10 grid rather than depending on SMASH_ROSTER's alphabetical
    // fallback order (the real behavior when favorites are empty, but not
    // something a test should have to hardcode/guess to stay deterministic).
    favorites?: string[];
  }
) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname.replace(/^.*\/api/, '');

    if (path === '/health') return route.fulfill({ json: { ok: true } });
    if (path === '/users/me') return route.fulfill({ json: { username: 'alice', avatar_url: null } });
    if (path === '/characters/favorites') return route.fulfill({ json: { characters: opts.favorites ?? [] } });
    if (path === '/characters/stats') return route.fulfill({ json: [] });

    if (path === `/draft/rooms/${opts.room.id}` && method === 'GET') {
      return route.fulfill({ json: opts.room });
    }
    if (path === `/draft/rooms/${opts.room.id}/pick` && method === 'PUT') {
      if (opts.onPick) return opts.onPick(route);
      return route.fulfill({ json: opts.room });
    }

    // Unrecognized call -- fail loudly in the test output (not a silent
    // pass-through to the real network) so a gap in this mock surfaces
    // immediately rather than as a mysterious real-network flake.
    console.warn(`[mock] unhandled API call: ${method} ${path}`);
    return route.fulfill({ status: 200, json: {} });
  });

  // The WS connection AppShell/useDraftRoom opens -- accept it and otherwise
  // stay silent unless a test explicitly pushes a message through the
  // returned handle. wsUrl() builds an absolute wss://... URL against
  // NEXT_PUBLIC_WS_ORIGIN, not the page's own origin, so this needs to match
  // by path suffix rather than assuming same-origin.
  let wsHandle: import('@playwright/test').WebSocketRoute | null = null;
  await page.routeWebSocket(/\/ws\/draft\//, (ws) => {
    wsHandle = ws;
    ws.onMessage(() => {
      // The real endpoint never expects a message FROM the client after the
      // initial auth token send (routers/draft.py's ws_manager subscription
      // is push-only from the server side) -- nothing to respond to.
    });
  });

  return {
    // Pushes a fake server broadcast to the client, same shape _push() sends
    // (routers/draft.py) -- used to simulate the masked broadcast racing a
    // slow HTTP response, or a status transition to 'revealed'/'live'.
    pushMessage(payload: unknown) {
      wsHandle?.send(JSON.stringify(payload));
    },
  };
}
