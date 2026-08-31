// /invites — port of web/public/invites.html's Received/Sent tabs. The
// "send a new invite" search/select form was dropped, not ported -- its JS
// existed on the legacy page but the HTML it targeted never did, so it was
// already dead/unreachable there. See CLAUDE.md's Known Gaps for the
// decision record. Today invites are only ever created automatically when
// starting a live tournament from the Bracket page.
'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import PageContainer, { PageHeader } from '../components/PageContainer';
import { apiDelete, apiGet, apiPatch, showToast } from '../lib/api';
import './invites.css';

const POLL_MS = 12000;

interface ReceivedInvite {
  id: number;
  bracket_id: number | null;
  bracket_name: string | null;
  inviter: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string | null;
}

interface SentInvite {
  id: number;
  bracket_name: string | null;
  invitee: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string | null;
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

function Badge({ status }: { status: 'pending' | 'accepted' | 'declined' }) {
  const label = status === 'pending' ? 'Pending' : status === 'accepted' ? 'Accepted' : 'Declined';
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export default function InvitesPage() {
  const [tab, setTab] = useState<'received' | 'sent'>('received');

  const [receivedLoading, setReceivedLoading] = useState(true);
  const [received, setReceived] = useState<ReceivedInvite[] | null>(null);

  const [sentLoading, setSentLoading] = useState(true);
  const [sent, setSent] = useState<SentInvite[] | null>(null);
  const [sentLoaded, setSentLoaded] = useState(false);

  async function loadReceived() {
    setReceivedLoading(true);
    try {
      const data = await apiGet<ReceivedInvite[]>('/invites/received');
      setReceived(data || []);
    } catch (err) {
      showToast('Error loading invites: ' + (err as Error).message, 'error');
    } finally {
      setReceivedLoading(false);
    }
  }

  async function loadSent() {
    setSentLoading(true);
    try {
      const data = await apiGet<SentInvite[]>('/invites/sent');
      setSent(data || []);
    } catch (err) {
      showToast('Error loading sent invites: ' + (err as Error).message, 'error');
    } finally {
      setSentLoading(false);
      setSentLoaded(true);
    }
  }

  useEffect(() => {
    loadReceived();
  }, []);

  // Poll for new invites every 12s while the Received tab is active, same
  // cadence as the legacy page.
  useEffect(() => {
    if (tab !== 'received') return;
    const t = setInterval(loadReceived, POLL_MS);
    return () => clearInterval(t);
  }, [tab]);

  function switchTab(next: 'received' | 'sent') {
    setTab(next);
    if (next === 'sent' && !sentLoaded) loadSent();
  }

  async function respondInvite(id: number, status: 'accepted' | 'declined', bracketId: number | null) {
    try {
      await apiPatch(`/invites/${id}`, { status });
      if (status === 'accepted' && bracketId) {
        window.location.href = `/tournament.html?id=${bracketId}`;
      } else {
        showToast('Invite declined.', 'info');
        loadReceived();
      }
    } catch (err) {
      showToast('Error: ' + (err as Error).message, 'error');
    }
  }

  async function cancelInvite(id: number) {
    if (!confirm('Cancel this invite?')) return;
    try {
      await apiDelete(`/invites/${id}`);
      showToast('Invite cancelled.', 'success');
      loadSent();
    } catch (err) {
      showToast('Error: ' + (err as Error).message, 'error');
    }
  }

  const pending = received?.filter((i) => i.status === 'pending') ?? [];
  const accepted = received?.filter((i) => i.status === 'accepted') ?? [];
  const declined = received?.filter((i) => i.status === 'declined') ?? [];

  const sectionHeading: CSSProperties = {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 10,
  };

  return (
    <PageContainer>
      <PageHeader>
        <h1>📬 Tournament Invites</h1>
        <p>Manage your tournament invitations.</p>
      </PageHeader>

      <div className="tabs">
        <button type="button" className={`tab-btn${tab === 'received' ? ' active' : ''}`} onClick={() => switchTab('received')}>
          Received
        </button>
        <button type="button" className={`tab-btn${tab === 'sent' ? ' active' : ''}`} onClick={() => switchTab('sent')}>
          Sent
        </button>
      </div>

      <div className={`tab-panel${tab === 'received' ? ' active' : ''}`}>
        {receivedLoading && (
          <div className="loading-center">
            <div className="spinner" />
            <span>Loading invites…</span>
          </div>
        )}
        {!receivedLoading && received && received.length === 0 && (
          <div className="empty-state">
            <p>No invites received yet.</p>
          </div>
        )}
        {!receivedLoading && received && received.length > 0 && (
          <div style={{ maxWidth: 700 }}>
            {pending.length > 0 && (
              <>
                <h2 style={sectionHeading}>Pending</h2>
                {pending.map((inv) => (
                  <div key={inv.id} className="invite-row">
                    <div className="invite-info">
                      <div className="invite-bracket">{inv.bracket_name || 'Tournament'}</div>
                      <div className="invite-meta">
                        From <strong>{inv.inviter}</strong> · {fmtDate(inv.created_at)}
                      </div>
                    </div>
                    <div className="invite-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => respondInvite(inv.id, 'accepted', inv.bracket_id)}>
                        Accept & Join
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => respondInvite(inv.id, 'declined', null)}>
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {accepted.length > 0 && (
              <>
                <h2 style={{ ...sectionHeading, margin: '16px 0 10px' }}>Accepted</h2>
                {accepted.map((inv) => (
                  <div key={inv.id} className="invite-row">
                    <div className="invite-info">
                      <div className="invite-bracket">{inv.bracket_name || 'Tournament'}</div>
                      <div className="invite-meta">
                        From <strong>{inv.inviter}</strong> · {fmtDate(inv.created_at)}
                      </div>
                    </div>
                    <div className="invite-actions">
                      <Badge status="accepted" />
                      {inv.bracket_id != null && (
                        <Link href={`/tournament.html?id=${inv.bracket_id}`} className="btn btn-primary btn-sm">
                          Open →
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            {declined.length > 0 && (
              <>
                <h2 style={{ ...sectionHeading, margin: '16px 0 10px' }}>Declined</h2>
                {declined.map((inv) => (
                  <div key={inv.id} className="invite-row">
                    <div className="invite-info">
                      <div className="invite-bracket">{inv.bracket_name || 'Tournament'}</div>
                      <div className="invite-meta">
                        From <strong>{inv.inviter}</strong> · {fmtDate(inv.created_at)}
                      </div>
                    </div>
                    <div>
                      <Badge status="declined" />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className={`tab-panel${tab === 'sent' ? ' active' : ''}`}>
        {sentLoading && (
          <div className="loading-center">
            <div className="spinner" />
            <span>Loading sent invites…</span>
          </div>
        )}
        {!sentLoading && sent && sent.length === 0 && (
          <div className="empty-state">
            <p>You haven&apos;t sent any invites yet.</p>
          </div>
        )}
        {!sentLoading && sent && sent.length > 0 && (
          <div style={{ maxWidth: 700 }}>
            {sent.map((inv) => (
              <div key={inv.id} className="invite-row">
                <div className="invite-info">
                  <div className="invite-bracket">{inv.bracket_name || 'Bracket'}</div>
                  <div className="invite-meta">
                    To <strong>{inv.invitee}</strong> · {fmtDate(inv.created_at)}
                  </div>
                </div>
                <div className="invite-actions">
                  <Badge status={inv.status} />
                  {inv.status === 'pending' && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => cancelInvite(inv.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Invites are sent automatically when you start a live tournament from the <Link href="/bracket.html">Bracket</Link> page.
      </p>
    </PageContainer>
  );
}
