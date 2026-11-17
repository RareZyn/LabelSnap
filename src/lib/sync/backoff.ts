export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 30 * 60_000;
export const MAX_ATTEMPTS = 8;

/** Exponential backoff with ±20 % jitter. `attempts` is the number of failures so far (1 = first failure). */
export function backoffDelay(attempts: number, random: () => number = Math.random): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(Math.min(MAX_DELAY_MS, exp * jitter));
}

export function isPermanentFailure(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
