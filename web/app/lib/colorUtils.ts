// colorUtils.ts — TS port of web/public/js/color-utils.js. Used by stats,
// duel, leaderboard, and profile (as those pages migrate) -- kept as its own
// module rather than duplicated per page, same reasoning as chars.ts.

export function winPctColor(pct: number | null | undefined): string {
  if (pct == null) return 'var(--text-muted)';
  const t = Math.max(0, Math.min(100, pct)) / 100;
  // 0% -> red (0deg), 50% -> yellow (55deg), 100% -> green (120deg)
  const hue = t < 0.5 ? (t / 0.5) * 55 : 55 + ((t - 0.5) / 0.5) * 65;
  return `hsl(${hue.toFixed(0)}, 75%, 52%)`;
}
