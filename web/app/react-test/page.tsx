'use client';

import { useState } from 'react';

export default function ReactTestPage() {
  const [count, setCount] = useState(0);

  return (
    <main style={{ padding: '48px', fontFamily: 'var(--font-display)' }}>
      <div
        className="glass"
        style={{
          maxWidth: 420,
          padding: 24,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--glass-border)',
          background: 'var(--glass-bg)',
          backdropFilter: `blur(var(--glass-blur))`,
          WebkitBackdropFilter: `blur(var(--glass-blur))`,
          color: 'var(--text)',
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Phase 4 toolchain check
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
          If this card looks glassy and the counter below works, React + the
          ported CSS tokens are both live.
        </p>
        <button
          type="button"
          onClick={() => setCount((c) => c + 1)}
          style={{
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }}
        >
          count: {count}
        </button>
      </div>
    </main>
  );
}
