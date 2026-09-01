// /login — port of web/public/login.html. Same frictionless "tap a player
// tile to enter" flow (no password field at all -- POST /auth/enter just
// takes a username), same tap-to-arm/tap-again-to-confirm tiles, same
// new-player form, same server-ready gate on the submit button. Markup/CSS
// classes kept identical to auth.css (imported below) so this renders
// pixel-for-pixel like the legacy page; only the DOM-scripting became React
// state. web/public/login.html itself is untouched -- every un-migrated
// legacy page's requireAuth() still redirects there, so it has to keep
// working as a static page until every page linking to it has migrated too.
'use client';

import { useEffect, useRef, useState } from 'react';
import '../../public/css/auth.css';
import { API_BASE, apiGet, apiPost, getToken, setToken, setUsername } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const WAIT_ATTEMPTS = 10; // up to ~90s, matches the original waitForServer()

export default function LoginPage() {
  useDocumentTitle('Smash Bracket — Sign In');
  const [redirecting, setRedirecting] = useState(true);
  const [serverReady, setServerReady] = useState(false);
  const [serverNotice, setServerNotice] = useState<string | null>(null);

  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [hiddenUsernames, setHiddenUsernames] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [tilesError, setTilesError] = useState<string | null>(null);

  const [armedTile, setArmedTile] = useState<string | null>(null);
  const armedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [busyTile, setBusyTile] = useState<string | null>(null);
  const [enterError, setEnterError] = useState<string | null>(null);

  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerNameError, setNewPlayerNameError] = useState(false);

  // redirectIfLoggedIn() equivalent -- already-authed visitors don't see the
  // login form at all. Runs before the rest of the page renders.
  useEffect(() => {
    if (getToken()) {
      window.location.href = '/';
      return;
    }
    setRedirecting(false);
  }, []);

  // waitForServer() equivalent -- gates the submit buttons, not just a toast.
  useEffect(() => {
    if (redirecting) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < WAIT_ATTEMPTS && !cancelled; i++) {
        try {
          const r = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
          if (r.ok) {
            if (!cancelled) setServerReady(true);
            return;
          }
        } catch {
          // keep retrying, same swallow as the original
        }
        await new Promise((resolve) => setTimeout(resolve, i === 0 ? 2000 : 10000));
      }
      if (!cancelled) {
        setServerReady(true); // give up waiting -- let them try anyway
        setServerNotice('Server may still be starting. If this fails, wait 30s and try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [redirecting]);

  // loadPlayerTiles() equivalent
  useEffect(() => {
    if (redirecting) return;
    apiGet<{ usernames: string[]; hidden_usernames: string[] }>('/auth/users', false)
      .then((data) => {
        setUsernames(data.usernames || []);
        setHiddenUsernames(data.hidden_usernames || []);
      })
      .catch(() => {
        setTilesError('Could not load players. You can still enter a name below.');
        setUsernames([]);
      });
  }, [redirecting]);

  function disarmTile() {
    setArmedTile(null);
    if (armedTimeout.current) clearTimeout(armedTimeout.current);
  }

  function tapTile(name: string) {
    if (armedTile === name) {
      disarmTile();
      enter(name);
      return;
    }
    disarmTile();
    setArmedTile(name);
    armedTimeout.current = setTimeout(disarmTile, 2500);
  }

  async function enter(username: string) {
    setEnterError(null);
    setBusyTile(username);
    try {
      const data = await apiPost<{ token: string; username: string }>('/auth/enter', { username }, false);
      setToken(data.token);
      setUsername(data.username);
      const returnUrl = localStorage.getItem('loginReturnUrl');
      localStorage.removeItem('loginReturnUrl');
      window.location.href = returnUrl || '/';
    } catch (err) {
      setEnterError((err as Error).message || 'Something went wrong.');
      setBusyTile(null);
    }
  }

  function submitNewPlayer(e: React.FormEvent) {
    e.preventDefault();
    const name = newPlayerName.trim();
    setNewPlayerNameError(false);
    if (!name) {
      setNewPlayerNameError(true);
      return;
    }
    enter(name);
  }

  if (redirecting) return null;

  const visibleTiles = usernames ?? [];

  return (
    <div className="auth-page">
      <div className="auth-logo">
        Smash<span>Bros</span>
      </div>

      <div className="auth-card">
        {enterError && (
          <div className="auth-error-banner visible" role="alert">
            {enterError}
          </div>
        )}

        {usernames === null && !tilesError && <p className="tiles-status">Loading players…</p>}
        {tilesError && <p className="tiles-status">{tilesError}</p>}

        <div className="user-tiles">
          {visibleTiles.map((name) => (
            <button
              key={name}
              type="button"
              className={`tile-btn${armedTile === name ? ' tile-armed' : ''}`}
              disabled={!serverReady || busyTile === name}
              onClick={() => tapTile(name)}
            >
              {busyTile === name ? 'One sec…' : armedTile === name ? 'Tap again to confirm' : name}
            </button>
          ))}
          {showHidden &&
            hiddenUsernames.map((name) => (
              <button
                key={name}
                type="button"
                className={`tile-btn${armedTile === name ? ' tile-armed' : ''}`}
                disabled={!serverReady || busyTile === name}
                onClick={() => tapTile(name)}
              >
                {busyTile === name ? 'One sec…' : armedTile === name ? 'Tap again to confirm' : name}
              </button>
            ))}
        </div>

        {hiddenUsernames.length > 0 && !showHidden && (
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

        {usernames !== null && !showNewPlayerForm && (
          <button type="button" className="tile-btn tile-btn-new" onClick={() => setShowNewPlayerForm(true)}>
            + New player
          </button>
        )}

        {showNewPlayerForm && (
          <form className="new-player-form" noValidate onSubmit={submitNewPlayer}>
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
                className={newPlayerNameError ? 'input-error' : undefined}
                value={newPlayerName}
                onChange={(e) => {
                  setNewPlayerName(e.target.value);
                  setNewPlayerNameError(false);
                }}
              />
              <p className={`field-error${newPlayerNameError ? ' visible' : ''}`}>Enter your name.</p>
            </div>

            <button type="submit" className="auth-submit" disabled={!serverReady || busyTile !== null}>
              {!serverReady ? 'Connecting to server…' : busyTile ? 'One sec…' : "Let's go"}
            </button>
            {serverNotice && <div className="auth-error-banner visible">{serverNotice}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
