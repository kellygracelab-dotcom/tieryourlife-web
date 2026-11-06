import type { KeyValueStore } from "../../lib/storage";

export interface KeptRanking {
  code: string;
  claimToken: string;
  /** The account the ranking was handed to, once it has been. */
  claimedBy?: string;
  /** An account the server said it is already kept away from; that account does not ask again. */
  refusedTo?: string;
  /** The rows the link holds, so a reload can show the link again rather than a fresh Finish. */
  rows?: number[][];
  /** The list's updatedAt when it was finished: the rows' numbers mean that version's cards. */
  version?: number;
}

const isRows = (value: unknown): value is number[][] =>
  Array.isArray(value) &&
  value.every((row) => Array.isArray(row) && row.every((item) => Number.isInteger(item)));

export const KEPT_PREFIX = "tyl:ranking:";

export const keptKey = (listId: string): string => `${KEPT_PREFIX}${listId}`;

/** The ranking this device finished for a list, so the page can say "yours". */
export function readKept(store: KeyValueStore, listId: string): KeptRanking | null {
  const text = store.read(keptKey(listId));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const { code, claimToken, claimedBy, refusedTo, rows, version } =
      parsed as Partial<KeptRanking>;
    if (typeof code !== "string" || typeof claimToken !== "string") return null;
    return {
      code,
      claimToken,
      ...(typeof claimedBy === "string" ? { claimedBy } : {}),
      ...(typeof refusedTo === "string" ? { refusedTo } : {}),
      ...(isRows(rows) ? { rows } : {}),
      ...(typeof version === "number" ? { version } : {}),
    };
  } catch {
    return null;
  }
}

export function writeKept(store: KeyValueStore, listId: string, kept: KeptRanking): void {
  store.write(keptKey(listId), JSON.stringify(kept));
}

/**
 * The ranking finished here, when it is the person's who is here: an
 * account's only to that account, so a guest or the next account on a shared
 * browser never reads another's as their own. One a guest finished goes to
 * whoever signs in next, so it shows to anybody here but an account the
 * server said it is kept away from. `who` is the account's uid, null for a
 * guest, undefined while nobody knows yet: then only a guest's shows.
 */
export function keptBy(
  kept: KeptRanking | null,
  who: string | null | undefined,
): KeptRanking | null {
  if (kept === null) return null;
  if (kept.claimedBy !== undefined) return kept.claimedBy === who ? kept : null;
  return typeof who === "string" && kept.refusedTo === who ? null : kept;
}

/** An account deleted: the rankings it kept go from this browser, so nobody here reads them as theirs. */
export function forgetKeptOf(store: KeyValueStore, uid: string): void {
  for (const key of store.keys?.() ?? []) {
    if (!key.startsWith(KEPT_PREFIX)) continue;
    if (readKept(store, key.slice(KEPT_PREFIX.length))?.claimedBy === uid) store.remove(key);
  }
}

/**
 * The link this device's ranking already has, when the board shows exactly
 * what it holds, of the same version of the list: a reload then shows that
 * link instead of offering another Finish.
 */
export function keptFor(
  kept: KeptRanking | null,
  version: number,
  rows: readonly (readonly number[])[],
): string | null {
  if (kept === null || kept.version !== version || kept.rows === undefined) return null;
  return JSON.stringify(kept.rows) === JSON.stringify(rows) ? kept.code : null;
}

/**
 * Forgets this device's ranking for a list once it was deleted, so the list's
 * page offers Finish again instead of calling a dead link live. Another
 * ranking finished for that list since is left alone.
 */
export function forgetKept(store: KeyValueStore, listId: string, code: string): void {
  if (readKept(store, listId)?.code === code) store.remove(keptKey(listId));
}
