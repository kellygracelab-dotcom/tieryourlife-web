import { sessionStorageStore, type KeyValueStore } from "../../lib/storage";

/**
 * What a guest asked for before signing in, kept while the sign-in leaves
 * the page through a redirect: the page they come back to does it then, as
 * a popup's sign-in does it at once.
 */
export type Intent = { kind: "follow"; uid: string } | { kind: "report"; listId: string };

const KEY = "tyl:afterSignIn";
// A sign-in that went away and came back is minutes, not hours: an intent
// older than that belongs to a sign-in that failed, and a later one must not
// follow somebody on its behalf.
export const INTENT_LASTS_MS = 10 * 60 * 1000;

let store: KeyValueStore = sessionStorageStore;

/** Tests keep their own store; the page keeps the tab's. */
export function intentStoreForTests(replacement: KeyValueStore): void {
  store = replacement;
}

export function keepIntent(intent: Intent, now = Date.now()): void {
  store.write(KEY, JSON.stringify({ ...intent, at: now }));
}

const same = (a: Intent, b: Intent): boolean =>
  a.kind === "follow" && b.kind === "follow"
    ? a.uid === b.uid
    : a.kind === "report" && b.kind === "report" && a.listId === b.listId;

/** Whether this was asked for before the sign-in. */
export function hasIntent(intent: Intent, now = Date.now()): boolean {
  let kept: unknown;
  try {
    kept = JSON.parse(store.read(KEY) ?? "null");
  } catch {
    kept = null;
  }
  if (typeof kept !== "object" || kept === null) return false;
  const at = (kept as { at?: unknown }).at;
  if (typeof at !== "number" || now - at > INTENT_LASTS_MS) {
    store.remove(KEY);
    return false;
  }
  return same(kept as Intent, intent);
}

/** Whether this was asked for before the sign-in; asked once, it is forgotten. */
export function takeIntent(intent: Intent, now = Date.now()): boolean {
  if (!hasIntent(intent, now)) return false;
  store.remove(KEY);
  return true;
}
