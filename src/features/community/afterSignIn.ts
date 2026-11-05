import { sessionStorageStore, type KeyValueStore } from "../../lib/storage";

/**
 * What a guest asked for before signing in, kept while the sign-in leaves
 * the page through a redirect: the page they come back to does it then, as
 * a popup's sign-in does it at once.
 */
export type Intent = { kind: "follow"; uid: string } | { kind: "report"; listId: string };

const KEY = "tyl:afterSignIn";

let store: KeyValueStore = sessionStorageStore;

/** Tests keep their own store; the page keeps the tab's. */
export function intentStoreForTests(replacement: KeyValueStore): void {
  store = replacement;
}

export function keepIntent(intent: Intent): void {
  store.write(KEY, JSON.stringify(intent));
}

const same = (a: Intent, b: Intent): boolean =>
  a.kind === "follow" && b.kind === "follow"
    ? a.uid === b.uid
    : a.kind === "report" && b.kind === "report" && a.listId === b.listId;

/** Whether this was asked for before the sign-in. */
export function hasIntent(intent: Intent): boolean {
  let kept: unknown;
  try {
    kept = JSON.parse(store.read(KEY) ?? "null");
  } catch {
    kept = null;
  }
  return typeof kept === "object" && kept !== null && same(kept as Intent, intent);
}

/** Whether this was asked for before the sign-in; asked once, it is forgotten. */
export function takeIntent(intent: Intent): boolean {
  if (!hasIntent(intent)) return false;
  store.remove(KEY);
  return true;
}
