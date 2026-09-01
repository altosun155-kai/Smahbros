// /play — port of web/public/play.html. Three link-cards (duel / draft /
// manual bracket). Nav, avatar/username, and the requireAuth()-equivalent
// guard are already handled globally by AuthGate + AppShell (see
// layout.tsx) so this page only needs its own content -- the legacy page's
// nav-inject.js script tag and inline /users/me fetch have no equivalent
// here, they're already covered.
//
// The only server component among the 14 ported pages (no client state, no
// effects) -- so unlike the other 13, its <title> is set the normal Next.js
// way via a real `metadata` export instead of the useDocumentTitle client
// hook, since a server component can do this natively.
import type { Metadata } from 'next';
import Link from 'next/link';
import PageContainer, { PageHeader } from '../components/PageContainer';
import './play.css';

export const metadata: Metadata = {
  title: 'Smash Bracket — Play',
};

export default function PlayPage() {
  return (
    <PageContainer>
      <PageHeader>
        <h1>Play</h1>
        <p>Choose how you want to play.</p>
      </PageHeader>

      <div className="play-grid">
        <Link className="card card-hover play-card" href="/duel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline>
            <line x1="13" y1="19" x2="19" y2="13"></line>
            <line x1="16" y1="16" x2="20" y2="20"></line>
            <line x1="19" y1="21" x2="21" y2="19"></line>
            <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"></polyline>
            <line x1="5" y1="14" x2="9" y2="18"></line>
            <line x1="7" y1="17" x2="4" y2="20"></line>
            <line x1="3" y1="19" x2="5" y2="21"></line>
          </svg>
          <span>1v1 Duel</span>
          <p>Record a head-to-head match.</p>
        </Link>
        <Link className="card card-hover play-card" href="/draft">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="10" width="12" height="12" rx="2" ry="2"></rect>
            <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 5.08"></path>
            <path d="M6 18h.01"></path>
            <path d="M10 14h.01"></path>
            <path d="M15 6h.01"></path>
            <path d="M18 9h.01"></path>
          </svg>
          <span>Draft</span>
          <p>Draft characters together in real time, then head into a bracket.</p>
        </Link>
        <Link className="card card-hover play-card" href="/bracket">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
            <path d="M4 22h16"></path>
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
          </svg>
          <span>Manual Bracket</span>
          <p>Seed players and set matchups yourself — no draft required.</p>
        </Link>
      </div>
    </PageContainer>
  );
}
