// haptics.ts — direct port of web/public/duel.html's existing haptic() pattern.
export function haptic(pattern: number | number[] = [10]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported / permission denied -- no-op
  }
}
