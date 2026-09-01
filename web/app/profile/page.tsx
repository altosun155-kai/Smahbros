// /profile — port of web/public/profile.html. Own-profile and
// viewing-someone-else's-profile in one page (via ?user=<username>), badge
// system with themed body backgrounds, avatar generator/editor bottom
// sheet, H2H rival search, character showcase + hand-drawn interactive SVG
// Elo chart, activity feed, GG wall comments, and (own profile only) a
// brackets summary + home-background character picker + sign out.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageContainer from '../components/PageContainer';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, clearToken, showToast } from '../lib/api';
import { charHeadUrl, charImgUrl, SMASH_ROSTER } from '../lib/chars';
import { winPctColor } from '../lib/colorUtils';
import { BADGE_HOW, BADGE_ICONS, CHAR_EMOJIS } from '../lib/badges';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './profile.css';

const DICEBEAR_STYLES = ['pixel-art', 'adventurer', 'bottts', 'fun-emoji', 'shapes', 'identicon'];
const BADGE_THEME_PRIORITY = ['tourney_king', 'finisher', 'punching_bag', 'serial_champ', 'champion', 'top3', 'veteran', 'specialist'];

function dicebearUrl(style: string, seed: string) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}
function dicebearFallback(username: string) {
  return dicebearUrl('pixel-art', username);
}

interface Me {
  id: number;
  username: string;
  avatar_url: string | null;
  featured_badge: string | null;
  background_character: string | null;
}

interface ProfileBadge {
  id: string;
  label: string;
  desc?: string;
  color: string;
  character?: string;
}

interface UserStats {
  tournament_wins: number;
  three_stocks_given: number;
  three_stocked_received: number;
}

interface CharStat {
  character: string;
  elo?: number;
  wins?: number;
  losses?: number;
}

interface ActivityRow {
  id: number;
  winner: string;
  winner_char: string;
  loser: string;
  loser_char: string;
  elo_delta: number;
  created_at: string;
}

interface Comment {
  id: number;
  author: string;
  author_avatar: string | null;
  content: string;
  created_at: string;
}

interface H2HMatchupData {
  user1: string;
  user2: string;
  user1_wins: number;
  user2_wins: number;
  user1_kills?: number;
  user2_kills?: number;
  total: number;
  leader: string | null;
  chars?: Record<string, { wins: number; losses: number; kills?: number; deaths?: number }>;
  matchups?: Record<string, { user1_char: string; user2_char: string; user1_wins: number; user2_wins: number; user1_kills?: number; user2_kills?: number }>;
}

interface EloHistRow {
  elo_delta: number;
  opponent: string;
  opponent_char: string;
  created_at: string;
}

function slugifyChar(c: string) {
  return c.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function badgeIconForId(b: ProfileBadge, forModal = false): { text?: string; img?: string } {
  if (b.id === 'specialist' || b.id === 'char_legend' || b.id === 'old_reliable') {
    const char = b.character || b.label.replace(/ Specialist$/, '').replace(/ Legend$/, '');
    const url = forModal ? charImgUrl(char) : charHeadUrl(char);
    if (url) return { img: url };
    return { text: CHAR_EMOJIS[char] || BADGE_ICONS[b.id] || '🏅' };
  }
  return { text: BADGE_ICONS[b.id] || '🏅' };
}

export default function ProfilePage() {
  useDocumentTitle('Smash Bracket — Profile');
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('user');
  const viewingOther = !!viewParam;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [myUsername, setMyUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentAvatar, setCurrentAvatar] = useState('');

  const [badges, setBadges] = useState<ProfileBadge[]>([]);
  const [featuredBadgeId, setFeaturedBadgeId] = useState<string | null>(null);
  const [badgeModal, setBadgeModal] = useState<ProfileBadge | null>(null);

  const [stats, setStats] = useState<UserStats | null>(null);

  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [avatarTab, setAvatarTab] = useState<'generate' | 'custom'>('generate');
  const [selectedStyle, setSelectedStyle] = useState('pixel-art');
  const [seedInput, setSeedInput] = useState('');
  const [customUrlInput, setCustomUrlInput] = useState('');

  const [myBracketsSummary, setMyBracketsSummary] = useState('Loading…');
  const [bgChar, setBgChar] = useState('');
  const [bgCharSaved, setBgCharSaved] = useState(false);

  const [rivalInput, setRivalInput] = useState('');
  const [rivalUsername, setRivalUsername] = useState('');
  const [rivalResults, setRivalResults] = useState<{ username: string }[]>([]);
  const [rivalDropdownOpen, setRivalDropdownOpen] = useState(false);
  const [h2h, setH2h] = useState<H2HMatchupData | null>(null);
  const [h2hEmpty, setH2hEmpty] = useState(false);

  const [showcaseStats, setShowcaseStats] = useState<CharStat[]>([]);
  const [showcaseLoading, setShowcaseLoading] = useState(true);
  const [activeChar, setActiveChar] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentInput, setCommentInput] = useState('');

  // ── Apply badge theme to <body> ──
  useEffect(() => {
    document.body.className = document.body.className.replace(/\bbadge-\S+/g, '').trim();
    if (!badges.length) return;
    const ids = new Set(badges.map((b) => b.id));
    const match = BADGE_THEME_PRIORITY.find((id) => ids.has(id));
    if (match) document.body.classList.add(`badge-${match}`);
    return () => {
      document.body.className = document.body.className.replace(/\bbadge-\S+/g, '').trim();
    };
  }, [badges]);

  useEffect(() => {
    if (badgeModal) {
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setBadgeModal(null);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [badgeModal]);

  // ── Init ──
  useEffect(() => {
    (async () => {
      let meData: Me | null = null;
      try {
        meData = await apiGet<Me>('/users/me');
        setMe(meData);
        setMyUsername(meData.username);
      } catch {
        // same silent catch as the original
      }

      let username = '';
      if (viewingOther && viewParam) {
        try {
          const u = await apiGet<{ username: string; avatar_url: string | null }>(`/users/${encodeURIComponent(viewParam)}/profile`);
          username = u.username;
          setCurrentUsername(u.username);
          setCurrentAvatar(u.avatar_url || dicebearFallback(u.username));
        } catch {
          setNotFound(true);
          setLoading(false);
          return;
        }
      } else if (meData) {
        username = meData.username;
        setCurrentUsername(meData.username);
        setCurrentAvatar(meData.avatar_url || dicebearFallback(meData.username));
        setSeedInput(meData.username);
        setBgChar(meData.background_character || '');
        setFeaturedBadgeId(meData.featured_badge || null);

        apiGet<{ name: string }[]>('/brackets')
          .then((brackets) => {
            setMyBracketsSummary(brackets && brackets.length ? `${brackets.length} tournament${brackets.length === 1 ? '' : 's'} — most recent: ${brackets[0].name}` : 'No tournaments yet.');
          })
          .catch(() => setMyBracketsSummary('Could not load.'));
      }

      setLoading(false);

      if (viewingOther && meData) {
        setRivalUsername(meData.username);
        setRivalInput(meData.username);
      }

      if (username) {
        Promise.allSettled([
          apiGet<ProfileBadge[]>(`/users/${encodeURIComponent(username)}/badges`).then(setBadges),
          apiGet<UserStats>(`/users/${encodeURIComponent(username)}/stats`).then(setStats),
        ]);
        loadShowcase(username);
        loadActivity(username);
        loadComments(username);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam]);

  // Auto-load H2H once both usernames are known, when viewing someone else.
  useEffect(() => {
    if (viewingOther && rivalUsername && currentUsername) loadH2H();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingOther, rivalUsername, currentUsername]);

  async function loadShowcase(username: string) {
    setShowcaseLoading(true);
    try {
      const data = await apiGet<{ stats?: CharStat[] }>(`/characters/stats/${encodeURIComponent(username)}`);
      const rows = (data.stats || [])
        .filter((s) => (s.wins || 0) + (s.losses || 0) >= 1)
        .sort((a, b) => (b.elo || 1000) - (a.elo || 1000))
        .slice(0, 5);
      setShowcaseStats(rows);
      if (rows.length) setActiveChar(rows[0].character);
    } catch {
      setShowcaseStats([]);
    } finally {
      setShowcaseLoading(false);
    }
  }

  async function loadActivity(username: string) {
    try {
      const data = await apiGet<ActivityRow[]>(`/users/${encodeURIComponent(username)}/activity`);
      setActivity(data || []);
    } catch {
      setActivity([]);
    }
  }

  async function loadComments(username: string) {
    try {
      const data = await apiGet<Comment[]>(`/users/${encodeURIComponent(username)}/comments`);
      setComments(data || []);
    } catch {
      setComments([]);
    }
  }

  async function postComment() {
    const content = commentInput.trim();
    if (!content) return;
    try {
      const c = await apiPost<Comment>(`/users/${encodeURIComponent(currentUsername)}/comments`, { content });
      setCommentInput('');
      setComments((prev) => [c, ...(prev || [])]);
    } catch (err) {
      showToast('Error posting: ' + (err as Error).message, 'error');
    }
  }

  async function deleteComment(id: number) {
    try {
      await apiDelete(`/comments/${id}`);
      setComments((prev) => (prev || []).filter((c) => c.id !== id));
    } catch (err) {
      showToast('Error: ' + (err as Error).message, 'error');
    }
  }

  async function pinBadge(badgeId: string) {
    const newId = featuredBadgeId === badgeId ? '' : badgeId;
    try {
      await apiPatch('/users/me/featured-badge', { badge_id: newId });
      setFeaturedBadgeId(newId || null);
      showToast(newId ? 'Badge featured!' : 'Badge unpinned.', 'success');
    } catch {
      showToast('Failed to update badge.', 'error');
    }
  }

  async function saveAvatar(url: string) {
    try {
      await apiPut('/users/me/avatar', { avatar_url: url });
      setCurrentAvatar(url);
      showToast('Avatar saved!', 'success');
      setAvatarSheetOpen(false);
    } catch (err) {
      showToast('Error saving avatar: ' + (err as Error).message, 'error');
    }
  }

  async function saveBgChar(char: string) {
    setBgChar(char);
    setBgCharSaved(false);
    try {
      await apiPatch('/users/me/background-character', { character: char || null });
      setBgCharSaved(true);
      setTimeout(() => setBgCharSaved(false), 2000);
    } catch (err) {
      showToast('Could not save: ' + (err as Error).message, 'error');
    }
  }

  const rivalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onRivalInputChange(v: string) {
    setRivalInput(v);
    setRivalUsername('');
    if (rivalSearchTimer.current) clearTimeout(rivalSearchTimer.current);
    const q = v.trim();
    if (!q) {
      setRivalDropdownOpen(false);
      return;
    }
    rivalSearchTimer.current = setTimeout(async () => {
      try {
        const users = await apiGet<{ username: string }[]>(`/users/search?q=${encodeURIComponent(q)}`);
        setRivalResults(users || []);
        setRivalDropdownOpen(!!users?.length);
      } catch {
        // ignore
      }
    }, 250);
  }

  async function loadH2H() {
    const rival = rivalUsername;
    if (!rival) {
      showToast('Select a rival first.', 'warn');
      return;
    }
    try {
      const d = await apiGet<H2HMatchupData>(`/users/${encodeURIComponent(currentUsername)}/h2h/${encodeURIComponent(rival)}`);
      if (d.total === 0) {
        setH2h(null);
        setH2hEmpty(true);
        return;
      }
      setH2hEmpty(false);
      setH2h(d);
    } catch (err) {
      showToast('Error: ' + (err as Error).message, 'error');
    }
  }

  const h2hCharRows = useMemo(() => {
    if (!h2h?.chars) return [];
    return Object.entries(h2h.chars)
      .map(([char, s]) => ({ char, wins: s.wins, losses: s.losses, total: s.wins + s.losses, kills: s.kills || 0, deaths: s.deaths || 0 }))
      .sort((a, b) => b.total - a.total);
  }, [h2h]);

  const h2hMatchupRows = useMemo(() => {
    if (!h2h?.matchups) return [];
    return Object.values(h2h.matchups)
      .map((m) => ({ ...m, total: m.user1_wins + m.user2_wins }))
      .sort((a, b) => b.total - a.total);
  }, [h2h]);

  const isOwnBadges = !viewingOther || currentUsername === myUsername;

  if (loading) {
    return (
      <PageContainer>
        <div className="page-header">
          <h1>{viewingOther ? `${viewParam}'s Profile` : '⚙️ Profile'}</h1>
        </div>
        <div className="loading-center">
          <div className="spinner" />
          <span>Loading profile…</span>
        </div>
      </PageContainer>
    );
  }

  if (notFound) {
    return (
      <PageContainer>
        <div className="page-header">
          <h1>{viewParam}&apos;s Profile</h1>
        </div>
        <p>User not found.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="page-header">
        <h1>{viewingOther ? `${viewParam}'s Profile` : '⚙️ Profile'}</h1>
      </div>

      <div className="profile-layout">
        {/* Left: profile card */}
        <div className="profile-card">
          <div className="avatar-wrap">
            <img className="profile-avatar" src={currentAvatar} alt="avatar" />
            {!viewingOther && (
              <button type="button" className="avatar-edit-btn" style={{ display: 'flex' }} onClick={() => setAvatarSheetOpen(true)} title="Change avatar">
                ✏️
              </button>
            )}
          </div>
          {viewingOther && (
            <Link href="/profile" style={{ fontSize: '0.82rem', color: 'var(--accent-blue)', display: 'block', marginTop: 10, marginBottom: 10 }}>
              ← Your Profile
            </Link>
          )}
          <div className="profile-username">{currentUsername}</div>

          <div className="badges-row">
            {badges.map((b) => {
              const isPinned = b.id === featuredBadgeId;
              const icon = badgeIconForId(b);
              return (
                <span key={b.id} className="badge-pill" title={b.desc || ''} onClick={() => setBadgeModal(b)}>
                  <span className="badge-icon" style={{ color: b.color }}>
                    {icon.img ? <img className="badge-char-img" src={icon.img} alt="" /> : icon.text}
                  </span>
                  {b.label}
                  {isOwnBadges && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pinBadge(b.id);
                      }}
                      title={isPinned ? 'Featured' : 'Feature this badge'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', display: 'inline-flex', alignItems: 'center', color: b.color }}
                    >
                      <span className={`badge-pin-dot${isPinned ? ' pinned' : ''}`} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {stats && (
            <div style={{ marginBottom: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>🏆 Tournament Wins</span>
                  <span className="num" style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {stats.tournament_wins}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>⚡ 3-Stocks Given</span>
                  <span className="num" style={{ fontWeight: 700, color: '#00bcd4' }}>
                    {stats.three_stocks_given}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>💀 Times 3-Stocked</span>
                  <span className="num" style={{ fontWeight: 700, color: '#e74c3c' }}>
                    {stats.three_stocked_received}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Avatar editor bottom sheet */}
        {!viewingOther && (
          <>
            <div className={`sheet-backdrop${avatarSheetOpen ? ' open' : ''}`} onClick={() => setAvatarSheetOpen(false)} />
            <div className={`bottom-sheet${avatarSheetOpen ? ' open' : ''}`}>
              <div className="sheet-handle" />
              <div className="tabs" style={{ marginBottom: 14 }}>
                <button type="button" className={`tab-btn${avatarTab === 'generate' ? ' active' : ''}`} onClick={() => setAvatarTab('generate')}>
                  Generate
                </button>
                <button type="button" className={`tab-btn${avatarTab === 'custom' ? ' active' : ''}`} onClick={() => setAvatarTab('custom')}>
                  Custom URL
                </button>
              </div>

              <div className={`tab-panel${avatarTab === 'generate' ? ' active' : ''}`}>
                <div className="style-grid">
                  {DICEBEAR_STYLES.map((s) => (
                    <button key={s} type="button" className={`style-btn${s === selectedStyle ? ' active' : ''}`} onClick={() => setSelectedStyle(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <input type="text" placeholder="Seed text…" style={{ fontSize: '0.85rem' }} value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
                </div>
                <img className="avatar-preview" src={dicebearUrl(selectedStyle, seedInput.trim() || currentUsername || 'default')} alt="preview" style={{ margin: '8px auto' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => saveAvatar(dicebearUrl(selectedStyle, seedInput.trim() || currentUsername))}>
                    Save
                  </button>
                </div>
              </div>

              <div className={`tab-panel${avatarTab === 'custom' ? ' active' : ''}`}>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <input type="text" placeholder="https://…" style={{ fontSize: '0.85rem' }} value={customUrlInput} onChange={(e) => setCustomUrlInput(e.target.value)} />
                </div>
                {customUrlInput.trim() && <img className="avatar-preview" src={customUrlInput.trim()} alt="preview" style={{ margin: '8px auto' }} />}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const url = customUrlInput.trim();
                    if (!url) {
                      showToast('Enter a URL first.', 'warn');
                      return;
                    }
                    saveAvatar(url);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </>
        )}

        {/* Right column */}
        <div>
          {/* Top Characters + Elo Chart */}
          <div className="prof-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div className="prof-section-title" style={{ margin: 0 }}>
                Top Characters
              </div>
            </div>
            {showcaseLoading && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Loading…</div>}
            {!showcaseLoading && showcaseStats.length === 0 && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>No ranked matches yet. Play some games!</div>}
            {!showcaseLoading && showcaseStats.length > 0 && (
              <div>
                <div className="showcase-strip">
                  {showcaseStats.map((s) => {
                    const elo = s.elo || 1000;
                    const games = (s.wins || 0) + (s.losses || 0);
                    const winPct = games > 0 ? Math.round(((s.wins || 0) / games) * 100) : 0;
                    const eloColor = elo >= 1200 ? '#f5a623' : elo >= 1100 ? '#4caf50' : elo < 900 ? '#e74c3c' : 'var(--text)';
                    return (
                      <div
                        key={s.character}
                        className={`showcase-card${activeChar === s.character ? ' active' : ''}`}
                        onClick={() => setActiveChar(s.character)}
                      >
                        <div className="showcase-art" style={{ backgroundImage: `url('${charImgUrl(s.character)}')`, viewTransitionName: activeChar === s.character ? `char-portrait-${slugifyChar(s.character)}` : undefined } as React.CSSProperties} />
                        <div className="showcase-name" title={s.character}>
                          {s.character}
                        </div>
                        <div className="showcase-elo" style={{ color: eloColor }}>
                          {elo}
                        </div>
                        <div className="showcase-record">
                          {winPct}%&nbsp; {s.wins}W {s.losses}L
                        </div>
                      </div>
                    );
                  })}
                </div>
                {activeChar && <EloChartSection username={currentUsername} character={activeChar} currentElo={showcaseStats.find((s) => s.character === activeChar)?.elo || 1000} />}
              </div>
            )}
          </div>

          {/* H2H */}
          <div className="prof-section">
            <div className="prof-section-title">Head-to-Head Rivalry</div>
            <div style={{ display: 'flex', gap: 8, maxWidth: 400, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search for a rival…"
                  autoComplete="off"
                  value={rivalInput}
                  onChange={(e) => onRivalInputChange(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: '0.88rem', boxSizing: 'border-box' }}
                />
                {rivalDropdownOpen && rivalResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden', marginTop: 2, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                    {rivalResults.map((u) => (
                      <div
                        key={u.username}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.88rem', borderBottom: '1px solid var(--border)' }}
                        onClick={() => {
                          setRivalUsername(u.username);
                          setRivalInput(u.username);
                          setRivalDropdownOpen(false);
                        }}
                      >
                        {u.username}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={loadH2H}>
                Compare
              </button>
            </div>

            {h2h && (
              <div style={{ marginTop: 14 }}>
                <div className="h2h-labels">
                  <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>
                    {h2h.user1} {h2h.user1_wins}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{h2h.total} matches</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                    {h2h.user2_wins} {h2h.user2}
                  </span>
                </div>
                <div className="h2h-bar">
                  <div className="h2h-bar-left" style={{ width: `${Math.round((h2h.user1_wins / h2h.total) * 100)}%` }} />
                  <div className="h2h-bar-right" style={{ width: `${100 - Math.round((h2h.user1_wins / h2h.total) * 100)}%` }} />
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4, marginBottom: 14 }}>
                  {h2h.leader ? `${h2h.leader} leads the rivalry.` : "It's dead even."}
                  {(h2h.user1_kills || 0) + (h2h.user2_kills || 0) > 0 ? ` · ${h2h.user1} ${h2h.user1_kills || 0}–${h2h.user2_kills || 0} ${h2h.user2} kills` : ''}
                </p>

                <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Your characters vs <span>{rivalUsername}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px' }}>Character</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>W</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>L</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>Win %</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>Kills</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>Deaths</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>K/D</th>
                      <th style={{ padding: '4px 8px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {h2hCharRows.map((r) => {
                      const winPct = r.total > 0 ? Math.round((r.wins / r.total) * 100) : 0;
                      const barColor = winPctColor(winPct);
                      const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills > 0 ? '∞' : '—';
                      const kdColor = r.deaths === 0 ? (r.kills > 0 ? '#4caf50' : 'var(--text-muted)') : r.kills / r.deaths >= 1 ? '#4caf50' : '#e74c3c';
                      return (
                        <tr key={r.char} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                          <td style={{ padding: '5px 8px', fontWeight: 600 }}>{r.char}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#4caf50', fontWeight: 700 }}>{r.wins}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e74c3c', fontWeight: 700 }}>{r.losses}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: barColor }}>{winPct}%</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e67e22', fontWeight: 700 }}>{r.kills || '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e74c3c', fontWeight: 700 }}>{r.deaths || '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: kdColor }}>{kd}</td>
                          <td style={{ padding: '5px 8px', width: 70 }}>
                            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${winPct}%`, background: barColor, borderRadius: 3 }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {h2hMatchupRows.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Character Matchups</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                          <th style={{ padding: '4px 8px' }}>Your Char</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }} />
                          <th style={{ padding: '4px 8px' }}>Their Char</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }}>W</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }}>L</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }}>Kills</th>
                          <th style={{ padding: '4px 8px', textAlign: 'center' }}>Deaths</th>
                          <th style={{ padding: '4px 8px' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {h2hMatchupRows.map((m, i) => {
                          const winPct = m.total > 0 ? Math.round((m.user1_wins / m.total) * 100) : 0;
                          const barColor = winPctColor(winPct);
                          const u1k = m.user1_kills || 0;
                          const u2k = m.user2_kills || 0;
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                              <td style={{ padding: '5px 8px', fontWeight: 600 }}>{m.user1_char}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>vs</td>
                              <td style={{ padding: '5px 8px', fontWeight: 600 }}>{m.user2_char}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', color: '#4caf50', fontWeight: 700 }}>{m.user1_wins}W</td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e74c3c', fontWeight: 700 }}>{m.user2_wins}L</td>
                              {u1k + u2k > 0 ? (
                                <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e67e22', fontWeight: 700, fontSize: '0.78rem' }} colSpan={2}>
                                  {u1k}–{u2k} kills
                                </td>
                              ) : (
                                <td colSpan={2} />
                              )}
                              <td style={{ padding: '5px 8px', width: 60 }}>
                                <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${winPct}%`, background: barColor, borderRadius: 3 }} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {h2hEmpty && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 10 }}>No matches recorded yet between these players.</div>}
          </div>

          {/* My Brackets — own profile only */}
          {!viewingOther && (
            <div className="prof-section">
              <div className="prof-section-title">My Brackets</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{myBracketsSummary}</div>
              <Link href="/my-brackets" className="btn btn-outline btn-sm" style={{ marginTop: 10, display: 'inline-block' }}>
                View My Brackets →
              </Link>
            </div>
          )}

          {/* Home Background — own profile only */}
          {!viewingOther && (
            <div className="prof-section">
              <div className="prof-section-title">Home Background</div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>Choose which character fades in behind your home menu.</p>
              <select
                value={bgChar}
                onChange={(e) => saveBgChar(e.target.value)}
                style={{ width: '100%', maxWidth: 280, background: 'var(--card-bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '8px 10px', fontSize: '0.88rem' }}
              >
                <option value="">Auto (site champion)</option>
                {SMASH_ROSTER.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {bgCharSaved && <span style={{ marginLeft: 10, fontSize: '0.8rem', color: '#27ae60' }}>Saved ✓</span>}
            </div>
          )}

          {/* Activity feed */}
          <div className="prof-section">
            <div className="prof-section-title">Recent Activity</div>
            {activity === null && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Loading…</div>}
            {activity !== null && activity.length === 0 && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>No matches recorded yet. Play some games!</div>}
            {activity !== null && activity.length > 0 && <ActivityFeed rows={activity} currentUsername={currentUsername} />}
          </div>

          {/* GG Wall */}
          <div className="prof-section">
            <div className="prof-section-title">GG Wall</div>
            {comments === null && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Loading…</div>}
            {comments !== null && comments.length === 0 && <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: 10 }}>No comments yet. Be the first!</div>}
            {comments !== null &&
              comments.map((c) => (
                <div key={c.id} className="comment-item">
                  <img
                    className="comment-av"
                    src={c.author_avatar || dicebearFallback(c.author)}
                    alt={c.author}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = dicebearFallback(c.author);
                    }}
                  />
                  <div className="comment-body">
                    <div className="comment-author">{c.author}</div>
                    <div className="comment-text">{c.content}</div>
                    <div className="comment-meta">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</div>
                  </div>
                  {c.author === currentUsername && (
                    <button type="button" className="comment-delete" title="Delete" onClick={() => deleteComment(c.id)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            <div className="comment-input-row">
              <input
                type="text"
                placeholder="Leave a GG…"
                maxLength={200}
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') postComment();
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={postComment}>
                Post
              </button>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 5 }}>{commentInput.length} / 200</div>
          </div>
        </div>
      </div>

      {/* Sign Out — own profile only */}
      {!viewingOther && (
        <button
          type="button"
          className="profile-signout-row"
          onClick={() => {
            clearToken();
            window.location.href = '/login';
          }}
        >
          Sign Out
        </button>
      )}

      {/* Badge detail modal */}
      {badgeModal && (
        <div
          id="badgeModal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBadgeModal(null);
          }}
        >
          <div className="badge-modal-box">
            <button type="button" className="badge-modal-close" onClick={() => setBadgeModal(null)}>
              ✕
            </button>
            <div className="badge-modal-icon">
              {(() => {
                const icon = badgeIconForId(badgeModal, true);
                return icon.img ? <img src={icon.img} alt="" /> : <span style={{ fontSize: '2.4rem' }}>{icon.text}</span>;
              })()}
            </div>
            <div className="badge-modal-name">{badgeModal.label}</div>
            <div className="badge-modal-stat">{badgeModal.desc || ''}</div>
            <div className="badge-modal-how">{BADGE_HOW[badgeModal.id] || ''}</div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function ActivityFeed({ rows, currentUsername }: { rows: ActivityRow[]; currentUsername: string }) {
  function feedTimeAgo(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }
  function feedDayLabel(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yest)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  let lastDay: string | null = null;

  return (
    <div>
      {rows.map((r) => {
        const won = r.winner === currentUsername;
        const myChar = won ? r.winner_char : r.loser_char;
        let dayHeader: React.ReactNode = null;
        if (r.created_at) {
          const day = feedDayLabel(r.created_at);
          if (day !== lastDay) {
            dayHeader = <div className="feed-day-header">{day}</div>;
            lastDay = day;
          }
        }
        const gain = r.elo_delta ? (won ? r.elo_delta : -r.elo_delta) : 0;
        return (
          <div key={r.id}>
            {dayHeader}
            <div className="feed-item enter-view">
              <img
                className="feed-portrait"
                src={charImgUrl(myChar)}
                alt={myChar}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              {won ? <span className="feed-win">W</span> : <span className="feed-loss">L</span>}
              <span className="feed-desc">
                {won ? (
                  <>
                    <span style={{ color: 'var(--text)' }}>{r.winner_char}</span> <span style={{ color: 'var(--text-muted)' }}>beat</span> {r.loser} <span style={{ color: 'var(--text-muted)' }}>playing</span> {r.loser_char}
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--text)' }}>{r.loser_char}</span> <span style={{ color: 'var(--text-muted)' }}>lost to</span> {r.winner} <span style={{ color: 'var(--text-muted)' }}>playing</span> {r.winner_char}
                  </>
                )}
              </span>
              {r.elo_delta ? (
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: gain > 0 ? '#4caf50' : '#e74c3c', flexShrink: 0 }}>
                  {gain > 0 ? '+' : ''}
                  {gain}
                </span>
              ) : null}
              <span className="feed-date" title={r.created_at ? new Date(r.created_at).toLocaleString() : ''}>
                {r.created_at ? feedTimeAgo(r.created_at) : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Elo chart + tooltip -- port of loadEloChart()/drawEloSvg(). The SVG's
// grid/line/dots are built from pure numbers (no user strings), so it's
// drawn imperatively via innerHTML same as the original; the tooltip is
// separate, React-rendered from state so any user string in it (opponent
// name/character) goes through JSX's normal escaping instead of innerHTML.
function EloChartSection({ username, character, currentElo }: { username: string; character: string; currentElo: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState<{ elo: number; label: string; match: EloHistRow | null }[] | null>(null);
  const [historyLen, setHistoryLen] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; elo: number; match: EloHistRow | null; label: string; color: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setHistoryLen(null);
    (async () => {
      try {
        const history = await apiGet<EloHistRow[]>(`/matches/history?username=${encodeURIComponent(username)}&character=${encodeURIComponent(character)}&limit=30`);
        if (cancelled) return;
        if (!history || history.length < 2) {
          setHistoryLen(history ? history.length : 0);
          return;
        }
        const pts: { elo: number; label: string; match: EloHistRow | null }[] = [{ elo: currentElo, label: 'Now', match: null }];
        let elo = currentElo;
        for (const h of history) {
          elo = Math.round(elo - h.elo_delta);
          pts.push({ elo, label: h.created_at ? new Date(h.created_at).toLocaleString() : '', match: h });
        }
        pts.reverse();
        setPoints(pts);
        setHistoryLen(history.length);
      } catch {
        setHistoryLen(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, character, currentElo]);

  useEffect(() => {
    if (!points || !svgRef.current) return;
    drawEloSvg(svgRef.current, points, currentElo);
    function onResize() {
      if (svgRef.current && points) drawEloSvg(svgRef.current, points, currentElo);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [points, currentElo]);

  const stats = useMemo(() => {
    if (!points) return null;
    const elos = points.map((p) => p.elo);
    const peak = Math.max(...elos);
    const low = Math.min(...elos);
    const wins = points.filter((p) => p.match && p.match.elo_delta > 0).length;
    return { peak, low, wins, total: historyLen || 0 };
  }, [points, historyLen]);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!points || points.length < 2 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const W = rect.width;
    const pad = { left: 42, right: 44 };
    const iW = W - pad.left - pad.right;
    const mx = e.clientX - rect.left;
    const idx = Math.round(((mx - pad.left) / iW) * (points.length - 1));
    const i = Math.max(0, Math.min(points.length - 1, idx));
    const p = points[i];
    const elos = points.map((pt) => pt.elo);
    const minE = Math.min(...elos);
    const maxE = Math.max(...elos);
    const span = maxE - minE || 50;
    const yMin = minE - span * 0.2;
    const yMax = maxE + span * 0.2;
    const H = 200;
    const padTop = 18;
    const padBottom = 28;
    const iH = H - padTop - padBottom;
    const yOf = (v: number) => padTop + (1 - (v - yMin) / (yMax - yMin)) * iH;
    const trend = elos[elos.length - 1] - elos[0];
    const color = trend >= 0 ? '#4caf50' : '#e74c3c';
    setTooltip({ x: mx, y: yOf(p.elo), elo: p.elo, match: p.match, label: p.label, color });
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div className="prof-section-title" style={{ marginBottom: 8 }}>
        {character} — Elo History
      </div>
      <div className="elo-chart-wrap" style={{ background: 'var(--card-bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 8px 6px', overflow: 'hidden' }}>
        {points ? (
          <svg ref={svgRef} width="100%" height={200} style={{ display: 'block', overflow: 'visible' }} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)} />
        ) : (
          <svg width="100%" height={200} style={{ display: 'block', overflow: 'visible' }}>
            <text x="50%" y={historyLen === null ? 100 : 80} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={13}>
              {historyLen === null ? 'Loading…' : historyLen === 1 ? 'Need more matches for a chart' : 'No match history yet'}
            </text>
          </svg>
        )}
        {tooltip && (
          <div
            id="eloTooltip"
            style={{
              display: 'block',
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <div className="tt-elo" style={{ color: tooltip.color }}>
              {tooltip.elo}
            </div>
            {tooltip.match ? (
              <div className="tt-match">
                vs {tooltip.match.opponent} ({tooltip.match.opponent_char})
                <br />
                <span className="tt-delta" style={{ color: tooltip.match.elo_delta > 0 ? '#4caf50' : tooltip.match.elo_delta < 0 ? '#e74c3c' : 'var(--text-muted)' }}>
                  {tooltip.match.elo_delta > 0 ? '+' : ''}
                  {tooltip.match.elo_delta}
                </span>
                <span style={{ color: 'var(--text-muted)' }}> · {tooltip.label}</span>
              </div>
            ) : (
              <div className="tt-match" style={{ color: 'var(--text-muted)' }}>
                Starting point
              </div>
            )}
          </div>
        )}
      </div>
      {stats && (
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.75rem', flexWrap: 'wrap', color: 'var(--text-muted)' }}>
          <span>
            Showing <strong style={{ color: 'var(--text)' }}>{stats.total}</strong> matches
          </span>
          <span style={{ color: '#4caf50' }}>
            Peak <strong>{stats.peak}</strong>
          </span>
          <span style={{ color: '#e74c3c' }}>
            Low <strong>{stats.low}</strong>
          </span>
          <span>
            {stats.wins}W {stats.total - stats.wins}L in window
          </span>
        </div>
      )}
    </div>
  );
}

function drawEloSvg(svg: SVGSVGElement, points: { elo: number; label: string; match: EloHistRow | null }[], currentElo: number) {
  const W = svg.getBoundingClientRect().width || 500;
  const H = 200;
  svg.setAttribute('height', String(H));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pad = { top: 18, right: 44, bottom: 28, left: 42 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const elos = points.map((p) => p.elo);
  const minE = Math.min(...elos);
  const maxE = Math.max(...elos);
  const span = maxE - minE || 50;
  const yMin = minE - span * 0.2;
  const yMax = maxE + span * 0.2;

  const xOf = (i: number) => pad.left + (points.length < 2 ? iW / 2 : (i / (points.length - 1)) * iW);
  const yOf = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * iH;

  const trend = elos[elos.length - 1] - elos[0];
  const col = trend >= 0 ? '#4caf50' : '#e74c3c';
  const gid = `eloG${Date.now()}`;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const v = yMin + t * (yMax - yMin);
      const y = yOf(v).toFixed(1);
      return `<line x1="${pad.left}" y1="${y}" x2="${(pad.left + iW).toFixed(1)}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
              <text x="${(pad.left - 5).toFixed(1)}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.3)">${Math.round(v)}</text>`;
    })
    .join('');

  const base1000 =
    yMin < 1000 && yMax > 1000
      ? `<line x1="${pad.left}" y1="${yOf(1000).toFixed(1)}" x2="${(pad.left + iW).toFixed(1)}" y2="${yOf(1000).toFixed(1)}" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="4,3"/>`
      : '';

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.elo).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xOf(points.length - 1).toFixed(1)},${(pad.top + iH).toFixed(1)} L${xOf(0).toFixed(1)},${(pad.top + iH).toFixed(1)} Z`;

  const labelStep = Math.max(1, Math.floor(points.length / 5));
  const xLabels = points
    .map((p, i) => {
      if (i % labelStep !== 0 && i !== points.length - 1) return '';
      const lbl = i === points.length - 1 ? 'Now' : p.label.slice(5) || '';
      return lbl ? `<text x="${xOf(i).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="rgba(255,255,255,0.3)">${lbl}</text>` : '';
    })
    .join('');

  const dots = points
    .map((p, i) => {
      const last = i === points.length - 1;
      return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(p.elo).toFixed(1)}" r="${last ? 4 : 2}" fill="${col}" opacity="${last ? 1 : 0.55}"/>`;
    })
    .join('');

  const lx = xOf(points.length - 1);
  const ly = yOf(currentElo);
  const anchor = lx + 44 > W ? 'end' : 'start';
  const lxOff = anchor === 'end' ? lx - 7 : lx + 7;
  const fid = `${gid}glow`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${col}" stop-opacity="0.02"/>
      </linearGradient>
      <filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    ${grid}${base1000}
    <path d="${areaPath}" fill="url(#${gid})"/>
    <path d="${linePath}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" filter="url(#${fid})"/>
    ${dots}
    <text x="${lxOff.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${col}">${currentElo}</text>
    ${xLabels}
  `;
}
