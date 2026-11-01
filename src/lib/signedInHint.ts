import type { Account } from "./account";
import { localStorageStore, type KeyValueStore } from "./storage";

export const SIGNED_IN_KEY = "tyl:signedIn";

/**
 * Whether this device was signed in when last seen. Firebase takes a moment
 * to say who is here; what a signed-in person sees, Explore and Following,
 * is drawn from the start on its word instead of arriving late and pushing
 * the page down.
 */
export function wasSignedIn(store: KeyValueStore = localStorageStore): boolean {
  return store.read(SIGNED_IN_KEY) === "1";
}

/** Notes who is here for the next visit's first moment. */
export function noteSignedIn(account: Account, store: KeyValueStore = localStorageStore): void {
  if (account.kind === "signedIn") store.write(SIGNED_IN_KEY, "1");
  else store.remove(SIGNED_IN_KEY);
}
