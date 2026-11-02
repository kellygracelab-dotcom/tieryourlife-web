/** The name every tab of the site asks for before a sync run. */
export const SYNC_LOCK = "tyl:board-sync";

interface Locks {
  request<T>(name: string, work: () => Promise<T>): Promise<T>;
}

const browserLocks = (): Locks | null =>
  typeof navigator !== "undefined" && "locks" in navigator
    ? (navigator.locks as unknown as Locks)
    : null;

/**
 * One sync run at a time across every tab of the site. The tabs share one
 * store and one set of agreements: two runs at once both sent the same board,
 * each took the other's write for a change elsewhere, and each kept a copy.
 * The second tab waits, and reads the agreements the first one wrote. A
 * browser without locks runs as before.
 */
export function oneTabAtATime<T>(work: () => Promise<T>, locks = browserLocks()): Promise<T> {
  return locks === null ? work() : locks.request(SYNC_LOCK, work);
}
