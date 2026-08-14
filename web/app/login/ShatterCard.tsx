'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

const DESKTOP_COLS = 3;
const DESKTOP_ROWS = 4;
const MOBILE_COLS = 2;
const MOBILE_ROWS = 6;
const CROSSFADE_MS = 150;
const SCATTER_DURATION = 0.65;
const SCATTER_STAGGER = 0.025;

interface Pt {
  x: number;
  y: number;
}

interface Shard {
  clipPath: string;
  cx: number;
  cy: number;
}

// Shared vertex grid so adjacent shards' edges always line up exactly while
// assembled -- jittering each shard's corners independently would leave
// visible gaps/overlaps along shared edges. The outer border is left
// unjittered so the shard layer stays flush with the card's own edge.
function buildShards(cols: number, rows: number): Shard[] {
  const grid: Pt[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: Pt[] = [];
    for (let c = 0; c <= cols; c++) {
      const edge = c === 0 || c === cols || r === 0 || r === rows;
      const jitter = () => (Math.random() - 0.5) * 6;
      row.push({
        x: (c / cols) * 100 + (edge ? 0 : jitter()),
        y: (r / rows) * 100 + (edge ? 0 : jitter()),
      });
    }
    grid.push(row);
  }

  const shards: Shard[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      const cc = grid[r + 1][c + 1];
      const d = grid[r + 1][c];
      const pts = [a, b, cc, d];
      shards.push({
        clipPath: `polygon(${pts.map((p) => `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`).join(', ')})`,
        cx: (a.x + b.x + cc.x + d.x) / 4,
        cy: (a.y + b.y + cc.y + d.y) / 4,
      });
    }
  }
  return shards;
}

export default function ShatterCard({
  triggering,
  destination,
  championUrl,
  onComplete,
}: {
  triggering: boolean;
  destination: string;
  championUrl: string | null;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'assembling' | 'scattering'>('idle');
  const shardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const triggeredRef = useRef(false);
  const mobileRef = useRef(false);

  const desktopShards = useMemo(() => buildShards(DESKTOP_COLS, DESKTOP_ROWS), []);
  const mobileShards = useMemo(() => buildShards(MOBILE_COLS, MOBILE_ROWS), []);

  // Prefetch the destination as soon as it's known (page mount, before any tap) --
  // by the time the tween actually runs, the next page is already warm, so the
  // hard nav fired from onComplete costs ~nothing and the tween plays its full
  // intended length instead of being truncated or trailing off into dead air.
  useEffect(() => {
    if (!destination) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = destination;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [destination]);

  useEffect(() => {
    if (!triggering || triggeredRef.current) return;
    triggeredRef.current = true;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onComplete();
      return;
    }

    mobileRef.current = window.matchMedia('(max-width: 700px)').matches;
    setPhase('assembling');

    const assembleTimer = setTimeout(() => {
      setPhase('scattering');
      (async () => {
        const { gsap } = await import('gsap');
        const shards = mobileRef.current ? mobileShards : desktopShards;
        shardRefs.current.slice(0, shards.length).forEach((el, i) => {
          if (!el) return;
          const shard = shards[i];
          const dx = (shard.cx - 50) / 50;
          const dy = (shard.cy - 50) / 50;
          gsap.to(el, {
            x: dx * 220 + (Math.random() - 0.5) * 60,
            y: dy * 220 + (Math.random() - 0.5) * 60,
            rotation: (Math.random() - 0.5) * 120,
            opacity: 0,
            duration: SCATTER_DURATION,
            delay: i * SCATTER_STAGGER,
            ease: 'power2.in',
            onComplete: i === shards.length - 1 ? onComplete : undefined,
          });
        });
      })();
    }, CROSSFADE_MS);

    return () => clearTimeout(assembleTimer);
  }, [triggering, desktopShards, mobileShards, onComplete]);

  const shards = mobileRef.current ? mobileShards : desktopShards;
  const fillStyle: CSSProperties = championUrl
    ? { backgroundImage: `url(${championUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'var(--card-bg)', border: '1px solid var(--border)' };

  return (
    <div className={`shatter-layer ${phase !== 'idle' ? 'shatter-layer-visible' : ''}`}>
      {shards.map((shard, i) => (
        <div
          key={i}
          ref={(el) => {
            shardRefs.current[i] = el;
          }}
          className="shatter-shard"
          style={{ clipPath: shard.clipPath, ...fillStyle }}
        />
      ))}
    </div>
  );
}
