/**
 * How long, and how often, something refused by a busy picture site (503
 * SOURCE_BUSY, or a house publication whose pictures were not copied yet) is
 * waited for and asked again: a paste's lines, the picture search, the
 * house's publish. One rule for all of them.
 */

/**
 * A busy picture site (503 SOURCE_BUSY) is waited for until the time it
 * gives, then the same line is asked again. A time further off than this
 * gives the line up: it comes by its name, and the note says the site stayed busy.
 */
export const BUSY_WAIT_MAX_MS = 2 * 60 * 1000;
/** Without a time from the backend, a busy site is asked again after this long. */
export const BUSY_FALLBACK_MS = 10_000;
/** How many times one line asks a busy site before it goes by its name. */
export const BUSY_TRIES = 5;

/**
 * When a busy site is asked again, after it was asked `tries` times and gave
 * `retryAt`; null when it is given up: asked often enough, or a time too far off.
 */
export function busyUntil(
  retryAt: number | null | undefined,
  tries: number,
  now: number,
): number | null {
  if (tries >= BUSY_TRIES) return null;
  const until = retryAt ?? now + BUSY_FALLBACK_MS;
  return until - now > BUSY_WAIT_MAX_MS ? null : until;
}
