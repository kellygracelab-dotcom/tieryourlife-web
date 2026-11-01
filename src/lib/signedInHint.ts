import type { Account } from "./account";
import { localStorageStore, type KeyValueStore } from "./storage";

export const SIGNED_IN_KEY = "tyl:signedIn";

/** Who was signed in on this device when last seen: their name and face, as the header draws them. */
export interface LastSeen {
  displayName: string | null;
  photoUrl: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Who was signed in on this device when last seen, or null. Firebase takes a
 * moment to say who is here; what a signed-in person sees, their face in the
 * header, Explore and Following, is drawn from the start on its word instead
 * of Sign in flashing first and the page being pushed down after.
 */
export function lastSeen(store: KeyValueStore = localStorageStore): LastSeen | null {
  const kept = store.read(SIGNED_IN_KEY);
  if (kept === null) return null;
  try {
    const seen: unknown = JSON.parse(kept);
    if (typeof seen === "object" && seen !== null) {
      const { displayName, photoUrl } = seen as Record<string, unknown>;
      return { displayName: text(displayName), photoUrl: text(photoUrl) };
    }
  } catch {
    /* an older note, or a broken one: signed in, nothing more */
  }
  return { displayName: null, photoUrl: null };
}

export const wasSignedIn = (store: KeyValueStore = localStorageStore): boolean =>
  lastSeen(store) !== null;

/** Notes who is here for the next visit's first moment. */
export function noteSignedIn(account: Account, store: KeyValueStore = localStorageStore): void {
  if (account.kind === "signedIn") {
    const seen: LastSeen = { displayName: account.displayName, photoUrl: account.photoUrl };
    store.write(SIGNED_IN_KEY, JSON.stringify(seen));
  } else {
    store.remove(SIGNED_IN_KEY);
  }
}
