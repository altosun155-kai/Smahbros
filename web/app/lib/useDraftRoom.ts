'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPutFast, getToken, getUsername, wsUrl } from './api';

export interface DraftPick {
  slot_index: number;
  character: string | null;
  locked: boolean;
}

export interface DraftPlayer {
  id: number;
  username: string;
  avatar_url: string | null;
}

export interface DraftRoomState {
  id: number;
  status: 'lobby' | 'picking' | 'revealed' | 'live' | 'closed';
  host_id: number;
  num_players: number;
  chars_per_player: number;
  players: DraftPlayer[];
  picks: Record<string, DraftPick[]>;
  bracket_id: number | null;
  bracket_ids: number[];
  created_at: string;
}

export function useDraftRoom(roomId: number | null) {
  const [room, setRoom] = useState<DraftRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notJoined, setNotJoined] = useState(false);
  const myIdRef = useRef<number | null>(null);

  // Mirrors room.status for the WS handler below, which needs the PREVIOUS
  // status to detect a lobby -> picking transition -- reading `room` itself
  // there would close over whatever it was when the WS effect last ran, not
  // the latest value (room isn't in that effect's dependency array, and
  // shouldn't be: re-subscribing the socket on every status change would be
  // its own bug). Kept in sync with room via the effect right below it,
  // rather than a second independently-updated ref, so there's one source
  // of truth for "what status did we last know about".
  const roomStatusRef = useRef<DraftRoomState['status'] | null>(null);
  useEffect(() => {
    roomStatusRef.current = room?.status ?? null;
  }, [room]);

  // The current player's own picks, tracked separately from `room` while the
  // room is in "picking" status -- see the WS effect below for why. Seeded
  // from a real GET (which reveals the caller's own picks server-side, see
  // routers/draft.py's draft_room_to_dict(viewer_id=current_user.id)) and
  // from there on updated ONLY by this player's own optimistic actions via
  // applyMyPick/setPick, never by an incoming WS push while still picking.
  const [myPicks, setMyPicks] = useState<DraftPick[] | null>(null);
  const myPicksRef = useRef<DraftPick[] | null>(null);
  useEffect(() => {
    myPicksRef.current = myPicks;
  }, [myPicks]);

  // Per-slot monotonic sequence numbers -- setPick's rollback-on-failure only
  // applies if no newer request for THAT SAME slot has been issued since (a
  // global counter would also suppress a legitimate rollback for slot B just
  // because slot A happened to get tapped afterward; scoped per slot avoids
  // that false-suppression while still killing the specific race this exists
  // for -- two fast taps on the SAME slot, e.g. add-then-immediately-remove).
  const requestSeqRef = useRef<Record<number, number>>({});

  const refetch = useCallback(async () => {
    if (roomId == null) return;
    try {
      const data = await apiGet<DraftRoomState>(`/draft/rooms/${roomId}`);
      const me = data.players.find((p) => p.username === getUsername());
      if (me) {
        myIdRef.current = me.id;
        const mine = data.picks[String(me.id)];
        if (mine) setMyPicks(mine);
      }
      setRoom(data);
      setNotJoined(false);
      setError(null);
    } catch (e) {
      const message = (e as Error).message || '';
      if (message.toLowerCase().includes('not a member')) {
        setNotJoined(true);
      } else {
        setError(message);
      }
    }
  }, [roomId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // WebSocket: live updates while in the room. The broadcast is always built
  // masked during picking (routers/draft.py's _push always calls
  // draft_room_to_dict(viewer_id=None), so `reveal` is only true once
  // room.status leaves "picking") -- masked meaning every unlocked
  // character, including the picker's own, comes across as null. So while
  // still picking, an incoming push is never a source of truth for MY OWN
  // picks (myPicks owns that instead) -- but once status moves to
  // "revealed"/"live", the broadcast IS built with real characters for
  // everyone (room.status in (...) makes `reveal` true regardless of
  // viewer), so incoming.picks[myKey] becomes authoritative again and must
  // not be second-guessed against stale local state.
  useEffect(() => {
    if (roomId == null || notJoined) return;
    const token = getToken();
    if (!token) return;

    const ws = new WebSocket(wsUrl(`/ws/draft/${roomId}`));
    ws.onopen = () => {
      ws.send(token);
      // A reconnect means we may have missed pushes while disconnected --
      // myPicks has no self-heal path from the WS itself (it's never a
      // source of truth for our own picks pre-reveal), so re-seed it from a
      // real GET explicitly rather than trusting whatever it was before the
      // drop.
      refetch();
    };
    ws.onmessage = (evt) => {
      let incoming: DraftRoomState;
      try {
        incoming = JSON.parse(evt.data);
      } catch {
        return;
      }
      // A third moment myPicks can go stale with no self-heal path
      // otherwise, alongside the WS-reconnect and visibilitychange re-seeds
      // above/below: routers/draft.py's start_draft_room writes real picks
      // server-side (pre-fill) at the exact instant it flips the room from
      // 'lobby' to 'picking', for every player at once -- not just the host
      // who triggered it. A client already sitting on the lobby screen when
      // that happens seeded myPicks from a GET taken BEFORE pre-fill ran,
      // and the masked broadcast this handler normally trusts can never
      // carry that player's own picks to fix it (see the comment above this
      // effect) -- so without this, that client's local "0 picks" belief
      // never corrects itself. Reproduced live: it read as a stuck draft
      // screen -- every tap on an already-pre-filled character 400'd
      // ("You've already picked that character for another slot"), and
      // every tap on anything else silently overwrote a real pre-filled
      // pick, both because pickedSlotByChar/emptyIdx were computed from the
      // stale, all-empty myPicks. refetch() (not setRoom(incoming)) because
      // this is exactly the reconnect/visibilitychange situation -- local
      // truth needs re-grounding from a real GET, not from this broadcast.
      if (roomStatusRef.current !== 'picking' && incoming.status === 'picking') {
        refetch();
        return;
      }
      setRoom(incoming);
    };
    return () => ws.close();
  }, [roomId, notJoined, refetch]);

  // Same reasoning as the WS reconnect above -- a phone that sleeps mid-draft
  // and wakes up needs its own picks re-grounded from the DB, not just
  // whatever local state happened to survive the sleep.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);

  // The room view every consumer actually sees: `room` as-is, except while
  // picking, where picks[myKey] is spliced from the locally-owned myPicks
  // instead of the (always-masked-to-null-for-everyone-during-picking) value
  // the server just broadcast. DraftWaiting/DraftBracketPreview/DraftReveal/
  // page.tsx all keep reading room.picks[...] exactly as before -- this is
  // the only place that decides whose value wins.
  const myId = myIdRef.current;
  const composedRoom: DraftRoomState | null =
    room && myId != null && myPicks != null && room.status === 'picking'
      ? { ...room, picks: { ...room.picks, [String(myId)]: myPicks } }
      : room;

  // The only mutator for the current player's own slots: applies the change
  // optimistically (instant, no round-trip wait), fires the real PUT, and
  // rolls back on failure -- but only if this is still the most recent
  // request issued for this specific slot (see requestSeqRef above).
  const setPick = useCallback(
    async (slotIndex: number, character: string | null) => {
      if (roomId == null) return;
      const seq = (requestSeqRef.current[slotIndex] ?? 0) + 1;
      requestSeqRef.current[slotIndex] = seq;
      const prior = myPicksRef.current?.[slotIndex] ?? null;

      setMyPicks((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        next[slotIndex] = { slot_index: slotIndex, character, locked: prev[slotIndex]?.locked ?? false };
        return next;
      });

      try {
        // Fast-fail, not apiFetch's page-load-shaped retry: this is a tap
        // the player is actively watching resolve, not a cold-start wait --
        // see api.ts's apiFetchFast for why the two calls need different
        // shapes. A single ~3s attempt means a real failure (or a hung
        // connection) rolls back and surfaces quickly instead of leaving the
        // optimistic pick showing for up to ~75s of retries first.
        await apiPutFast(`/draft/rooms/${roomId}/pick`, { slot_index: slotIndex, character });
      } catch (e) {
        if (requestSeqRef.current[slotIndex] === seq) {
          setMyPicks((prev) => {
            if (!prev) return prev;
            const next = prev.slice();
            next[slotIndex] = prior ?? { slot_index: slotIndex, character: null, locked: false };
            return next;
          });
        }
        throw e;
      }
    },
    [roomId]
  );

  return { room: composedRoom, error, notJoined, refetch, myId, myPicks, setPick };
}
