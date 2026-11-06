import { sessionStorageStore, type KeyValueStore } from "./storage";

/**
 * A page's own piece of the app, fetched when it is first opened. After a
 * deploy, a tab opened before it asks for a file that is no longer there, and
 * the import is rejected. One quiet reload brings the new files; any later
 * failure in the same tab is a real one and is let through: to the error
 * page, or to the feature's own word that it could not open. The key, kept
 * for the tab's session, holds when that one reload was asked for.
 *
 * Once a tab, not once a while: any file can fail, not only a page's (the
 * back-up engine, Play's screens, the share picture), and one that never
 * comes would otherwise reload the tab again and again, in the middle of
 * someone's typing. A second deploy in one tab's life leaves the error
 * page's own Reload button.
 */
export const CHUNK_RETRY_KEY = "tyl:chunk-retry";

export interface FreshDeps {
  store?: KeyValueStore;
  /** Loads the tab again: at the address it was on its way to, or where it is when it was going nowhere. */
  reload?: (to: string | null) => void;
  online?: () => boolean;
  now?: () => number;
  /** Whether the person is in the middle of something a reload would throw away. */
  busy?: () => boolean;
}

/**
 * Text being typed, or a dialog open: a reload would lose it. A focused
 * field counts only with something in it; an empty one loses nothing.
 */
export function inTheMiddle(doc: Document = document): boolean {
  if (doc.querySelector("[aria-modal='true'], dialog[open]") !== null) {
    return true;
  }
  const active = doc.activeElement;
  if (active instanceof HTMLTextAreaElement) return active.value.length > 0;
  if (active instanceof HTMLInputElement) {
    return (
      !["button", "submit", "reset", "checkbox", "radio"].includes(active.type) &&
      active.value.length > 0
    );
  }
  // jsdom knows no isContentEditable: undefined reads as not.
  return active instanceof HTMLElement && active.isContentEditable === true;
}

const reloadTab = (to: string | null) => {
  if (to === null) window.location.reload();
  else window.location.assign(to);
};

/**
 * Where the tab is going while a page's chunk is fetched. The router moves
 * to a page's address only once its chunk is in, so a plain reload would
 * land the person back on the page they were leaving, the click lost; the
 * app tells this module how to ask its router.
 */
let goingTo: () => string | null = () => null;

export function reloadInto(where: () => string | null): void {
  goingTo = where;
}

// A store that refuses (a private window) cannot remember the try, so no reload: it could never end.
const tried = (store: KeyValueStore): boolean | null => {
  try {
    return store.read(CHUNK_RETRY_KEY) !== null;
  } catch {
    return null;
  }
};

/**
 * A reload asked for and not yet begun. Vite's own handler for a file that will
 * not come lets the import go on as if nothing happened once the reload is
 * asked for, and what follows (a module that resolved, or one that is empty)
 * must not ask again, nor draw an error on a page about to go.
 */
let reloading = false;

/** Tests play several page loads in one module. */
export function resetFreshChunkForTests(): void {
  reloading = false;
  goingTo = () => null;
}

/** Reloads the tab once for a chunk that will not come; true when it did. */
export function reloadOnce({
  store = sessionStorageStore,
  reload = reloadTab,
  online = () => navigator.onLine,
  now = Date.now,
  busy = inTheMiddle,
}: FreshDeps = {}): boolean {
  // Offline the file is missing for want of a connection, not for a deploy,
  // and a reload would only trade the whole site for the browser's own error
  // page: the page that would not open says so instead, in the site.
  if (!online()) return false;
  if (tried(store) !== false) return false;
  // Never under someone's hands: what would not open says so, and the work stays.
  if (busy()) return false;
  try {
    store.write(CHUNK_RETRY_KEY, String(now()));
  } catch {
    return false;
  }
  reloading = true;
  reload(goingTo());
  return true;
}

export function freshChunk<T>(load: () => Promise<T>, deps: FreshDeps = {}): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch (failure) {
      // The page is going away; nothing should draw an error in the meantime.
      if (reloading || reloadOnce(deps)) return new Promise<T>(() => undefined);
      throw failure;
    }
  };
}
