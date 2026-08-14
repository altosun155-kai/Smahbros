import type { Metadata } from 'next';
import '../public/css/reset.css';
import '../public/css/style.css';

export const metadata: Metadata = {
  title: 'Smash Bracket',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Minimal back-link -- the Next app has no full nav yet (porting the shared
            nav to React is a separate task); this just keeps /draft from being a
            dead end for anyone who lands here directly. */}
        <a
          href="/index.html"
          style={{
            position: 'fixed',
            top: 12,
            left: 12,
            zIndex: 50,
            fontFamily: 'var(--font-display)',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius)',
            padding: '6px 12px',
          }}
        >
          ← Smash Bracket
        </a>
        {children}
      </body>
    </html>
  );
}
