import { ApiFailure, errorOf } from "../api/errors";
import type { PictureAsk, PicturePage } from "../api/pictures";
import { currentLocale, fill, plural, strings } from "../strings";

/** Without a time from the backend, a refused search waits this long. */
const FALLBACK_WAIT_MS = 60_000;

/** When the picture searches the backend refused (429 SEARCH_LIMIT) may start again, if they were. */
export function searchLimitOf(reason: unknown): number | null {
  const error = errorOf(reason);
  return error.kind === "searchLimit" ? (error.retryAt ?? null) : null;
}

export const isSearchLimit = (reason: unknown): boolean => errorOf(reason).kind === "searchLimit";

/**
 * A picture search that, once the backend says the hour's or the day's
 * searches are used up, asks nothing more until the time it gave: it refuses
 * at once, the same way, so the box and a paste stop knocking (the backend
 * does not count a refusal, but a page has no business sending them).
 */
export function limitedSearch(
  find: (ask: PictureAsk) => Promise<PicturePage>,
  now: () => number = Date.now,
): (ask: PictureAsk) => Promise<PicturePage> {
  let until = 0;
  return async (ask) => {
    if (now() < until) throw new ApiFailure({ kind: "searchLimit", retryAt: until });
    try {
      return await find(ask);
    } catch (reason) {
      if (isSearchLimit(reason)) {
        until = Math.max(until, searchLimitOf(reason) ?? now() + FALLBACK_WAIT_MS);
        throw new ApiFailure({ kind: "searchLimit", retryAt: until });
      }
      throw reason;
    }
  };
}

/** "14:00", or with the day when it is not today: the searches start again then. */
export function searchAgainAt(retryAt: number, now: number = Date.now()): string {
  const at = new Date(Math.ceil(retryAt / 60_000) * 60_000);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(
    currentLocale(),
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
}

/** "Too many picture searches. Search again at 14:00." */
export const searchLimitText = (retryAt: number | null, now?: number): string =>
  retryAt === null
    ? strings.new.searchLimitSoon
    : fill(strings.new.searchLimit, { time: searchAgainAt(retryAt, now) });

/** "3 cards came without pictures: too many picture searches. Search again at 14:00." */
export const pasteLimitText = (unanswered: number, retryAt: number | null, now?: number): string =>
  retryAt === null || unanswered === 0
    ? searchLimitText(retryAt, now)
    : fill(plural(strings.new.pasteLimited, unanswered), { time: searchAgainAt(retryAt, now) });
