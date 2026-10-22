/**
 * Native recorder duration is useful metadata, but it is not a reliable turn
 * clock on every Expo Go/iOS recorder lifecycle. Keep a monotonic JavaScript
 * clock for VAD qualification and watchdogs instead.
 */
export function monotonicNowMs() {
  const now = globalThis.performance?.now?.();
  return Number.isFinite(now) ? now : Date.now();
}

export function handsFreeElapsedMs(startedAtMs: number, nowMs: number) {
  return Math.max(0, nowMs - startedAtMs);
}

/** A status poll from a prior recorder turn must never drive the active turn. */
export function isFreshHandsFreeStatus(
  checkedAtMs: number | null,
  startedAtMs: number,
) {
  return checkedAtMs !== null && checkedAtMs >= startedAtMs;
}
