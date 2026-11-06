import { sessionStorageStore, type KeyValueStore } from "./storage";

/**
 * A page's own piece of the app, fetched when it is first opened. After a
 * deploy, a tab opened before it asks for a file that is no longer there, and
 * the import is rejected. One quiet reload brings the new files; a second
 * failure in the same tab is a real one and is let through to the error page.
 * The key holds when that reload was asked for.
 */
export const CHUNK_RETRY_KEY = "tyl:chunk-retry";

/**
 * How long after a reload another missing file is a real failure, not a new
 * deploy. Any file can fail, not only a page's: the back-up engine, Play's
 * screens, the share picture. Were the try forgotten once some page came, a
 * file that never comes would reload the tab again on every page that asks
 * for it, forever. A deploy is rarer than this; one after it gets its own
 * reload, and one sooner still leaves the error page's own Reload button.
 */
export const CHUNK_RETRY_WINDOW_MS = 10 * 60_000;

export interface FreshDeps {
  store?: KeyValueStore;
  /** Loads the tab again: at the address it was on its way to, or where it is when it was going nowhere. */
  reload?: (to: string | null) => void;
  online?: () => boolean;
  now?: () => number;
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
const triedSince = (store: KeyValueStore, since: number): boolean | null => {
  try {
    const at = store.read(CHUNK_RETRY_KEY);
    if (at === null) return false;
    // A try written down in some other shape is an old one: it holds no time to count from.
    const time = Number(at);
    return Number.isFinite(time) && time > since;
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
}: FreshDeps = {}): boolean {
  // Offline the file is missing for want of a connection, not for a deploy,
  // and a reload would only trade the whole site for the browser's own error
  // page: the page that would not open says so instead, in the site.
  if (!online()) return false;
  const time = now();
  if (triedSince(store, time - CHUNK_RETRY_WINDOW_MS) !== false) return false;
  try {
    store.write(CHUNK_RETRY_KEY, String(time));
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
