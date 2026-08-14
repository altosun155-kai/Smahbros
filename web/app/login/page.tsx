'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '../../public/css/auth.css';
import { API_BASE, apiGet, apiPost, getToken, setToken, setUsername } from '../lib/api';
import { charImgUrl } from '../lib/chars';
import ShatterCard from './ShatterCard';

function safeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.href : null;
  } catch {
    return null;
  }
}

interface CharacterStatRow {
  character: string;
  games: number;
  elo: number;
}

export default function LoginPage() {
  const [destination, setDestination] = useState('/');
  const [championUrl, setChampionUrl] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [serverMessage, setServerMessage] = useState('');
  const [tilesLoading, setTilesLoading] = useState(true);
  const [tilesError, setTilesError] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [hiddenUsernames, setHiddenUsernames] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerNameError, setNewPlayerNameError] = useState(false);
  const [armedUsername, setArmedUsername] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [triggering, setTriggering] = useState(false);
  const armedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Already signed in -- bounce straight past the login screen.
  useEffect(() => {
    if (getToken()) window.location.href = '/';
  }, []);

  // loginReturnUrl is written by requireAuth() (web/public/js/auth.js) before it
  // even redirects here, so it's already available at mount -- no need to wait
  // for a successful login to know where the shatter should hand off to.
  useEffect(() => {
    setDestination(safeReturnUrl(localStorage.getItem('loginReturnUrl')) || '/');
  }, []);

  // Champion = #1 player on /leaderboard, rendered as their most-played character.
  // Both calls are public (auth=false); silently falls back to the chrome shard
  // version in ShatterCard if the leaderboard is empty or the lookup fails.
  useEffect(() => {
    (async () => {
      try {
        const lb = await apiGet<{ username: string }[]>('/leaderboard', false);
        const topUsername = lb?.[0]?.username;
        if (!topUsername) return;
        const stats = await apiGet<{ stats: CharacterStatRow[] }>(
          `/characters/stats/${encodeURIComponent(topUsername)}`,
          false
        );
        const rows = stats?.stats || [];
        if (!rows.length) return;
        const best = [...rows].sort((a, b) => b.games - a.games || b.elo - a.elo)[0];
        if (best?.character) setChampionUrl(charImgUrl(best.character));
      } catch {
        // no champion image -- ShatterCard falls back to plain chrome shards
      }
    })();
  }, []);

  // Server-ready gate: disable submission until /health responds (Render cold starts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 10; i++) {
        try {
          const r = await fetch(API_BASE + '/health', { cache: 'no-store' });
          if (r.ok) {
            if (!cancelled) setServerReady(true);
            return;
          }
        } catch {
          // keep retrying
        }
        await new Promise((res) => setTimeout(res, i === 0 ? 2000 : 10000));
      }
      if (!cancelled) {
        setServerReady(true);
        setServerMessage('Server may still be starting. If this fails, wait 30s and try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet<{ usernames: string[]; hidden_usernames: string[] }>('/auth/users', false);
        setUsernames(data.usernames || []);
        setHiddenUsernames(data.hidden_usernames || []);
      } catch {
        setTilesError(true);
      } finally {
        setTilesLoading(false);
      }
    })();
  }, []);

  const enter = useCallback(async (name: string) => {
    setErrorMessage('');
    setEntering(true);
    try {
      const data = await apiPost<{ token: string; username: string }>('/auth/enter', { username: name }, false);
      setToken(data.token);
      setUsername(data.username);
      localStorage.removeItem('loginReturnUrl');
      setTriggering(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Something went wrong.');
      setEntering(false);
    }
  }, []);

  const disarm = useCallback(() => {
    setArmedUsername(null);
    if (armedTimeoutRef.current) clearTimeout(armedTimeoutRef.current);
  }, []);

  function handleTileClick(name: string) {
    if (armedUsername === name) {
      disarm();
      enter(name);
      return;
    }
    disarm();
    setArmedUsername(name);
    armedTimeoutRef.current = setTimeout(disarm, 2500);
  }

  function handleNewPlayerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = newPlayerName.trim();
    setNewPlayerNameError(false);
    if (!name) {
      setNewPlayerNameError(true);
      return;
    }
    enter(name);
  }

  const handleShatterComplete = useCallback(() => {
    window.location.href = destination;
  }, [destination]);

  return (
    <div className="auth-page">
      <div id="toast-container" />

      <div className="auth-logo">
        Smash<span>Bros</span>
      </div>

      <div className="auth-card-wrap">
        <div className={`auth-card ${triggering ? 'auth-card-hidden' : ''}`}>
          <div className={`auth-error-banner ${errorMessage ? 'visible' : ''}`} role="alert">
            {errorMessage}
          </div>

          {tilesLoading && <p className="tiles-status">Loading players…</p>}
          {tilesError && <p className="tiles-status">Could not load players. You can still enter a name below.</p>}

          <div className="user-tiles">
            {usernames.map((name) => (
              <button
                key={name}
                type="button"
                className={`tile-btn ${armedUsername === name ? 'tile-armed' : ''}`}
                disabled={entering}
                onClick={() => handleTileClick(name)}
              >
                {armedUsername === name ? 'Tap again to confirm' : name}
              </button>
            ))}
            {showHidden &&
              hiddenUsernames.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`tile-btn ${armedUsername === name ? 'tile-armed' : ''}`}
                  disabled={entering}
                  onClick={() => handleTileClick(name)}
                >
                  {armedUsername === name ? 'Tap again to confirm' : name}
                </button>
              ))}
          </div>

          {!showHidden && hiddenUsernames.length > 0 && (
            <a
              href="#"
              className="show-hidden-link"
              onClick={(e) => {
                e.preventDefault();
                setShowHidden(true);
              }}
            >
              show test accounts
            </a>
          )}

          {!tilesLoading && !newPlayerOpen && (
            <button type="button" className="tile-btn tile-btn-new" onClick={() => setNewPlayerOpen(true)}>
              + New player
            </button>
          )}

          {newPlayerOpen && (
            <form className="new-player-form" noValidate onSubmit={handleNewPlayerSubmit}>
              <div className="form-group">
                <label htmlFor="newPlayerName">Your name</label>
                <input
                  type="text"
                  id="newPlayerName"
                  name="username"
                  placeholder="Your name"
                  autoComplete="username"
                  maxLength={24}
                  required
                  className={newPlayerNameError ? 'input-error' : ''}
                  value={newPlayerName}
                  onChange={(e) => {
                    setNewPlayerName(e.target.value);
                    setNewPlayerNameError(false);
                  }}
                />
                <p className={`field-error ${newPlayerNameError ? 'visible' : ''}`}>Enter your name.</p>
              </div>

              <button type="submit" className="auth-submit" disabled={!serverReady || entering}>
                {!serverReady ? 'Connecting to server…' : entering ? 'One sec…' : "Let's go"}
              </button>
            </form>
          )}

          {serverMessage && <p className="tiles-status">{serverMessage}</p>}
        </div>

        <ShatterCard
          triggering={triggering}
          destination={destination}
          championUrl={championUrl}
          onComplete={handleShatterComplete}
        />
      </div>
    </div>
  );
}
