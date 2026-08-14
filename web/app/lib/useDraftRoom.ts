'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, getToken, getUsername, wsUrl } from './api';

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

  const refetch = useCallback(async () => {
    if (roomId == null) return;
    try {
      const data = await apiGet<DraftRoomState>(`/draft/rooms/${roomId}`);
      const me = data.players.find((p) => p.username === getUsername());
      if (me) myIdRef.current = me.id;
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

  // WebSocket: live updates while in the room. Broadcasts are always masked (nobody's
  // unlocked character is visible to anyone but themselves, not even this player's own
  // second device) -- so an incoming push must never clobber picks we already know
  // about ourselves via a direct REST response.
  useEffect(() => {
    if (roomId == null || notJoined) return;
    const token = getToken();
    if (!token) return;

    const ws = new WebSocket(wsUrl(`/ws/draft/${roomId}`));
    ws.onopen = () => ws.send(token);
    ws.onmessage = (evt) => {
      let incoming: DraftRoomState;
      try {
        incoming = JSON.parse(evt.data);
      } catch {
        return;
      }
      setRoom((prev) => {
        const myId = myIdRef.current;
        if (!prev || myId == null) return incoming;
        const myKey = String(myId);
        const prevMine = prev.picks[myKey];
        const incomingMine = incoming.picks[myKey];
        if (!prevMine || !incomingMine) return incoming;
        const mergedMine = incomingMine.map((slot, i) => ({
          ...slot,
          character: slot.character ?? prevMine[i]?.character ?? null,
        }));
        return { ...incoming, picks: { ...incoming.picks, [myKey]: mergedMine } };
      });
    };
    return () => ws.close();
  }, [roomId, notJoined]);

  // Roadmap's explicit "don't trust the socket" instruction: on wake, re-read from the DB.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);

  return { room, error, notJoined, refetch, myId: myIdRef.current };
}
