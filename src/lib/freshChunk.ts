import { sessionStorageStore, type KeyValueStore } from "./storage";

/**
 * A page's own piece of the app, fetched when it is first opened. After a
 * deploy, a tab opened before it asks for a file that is no longer there, and
 * the import is rejected. One quiet reload brings the new files; a second
 * failure in the same tab is a real one and is let through to the error page.
 */
export const CHUNK_RETRY_KEY = "tyl:chunk-retry";

export interface FreshDeps {
  store?: KeyValueStore;
  /** Loads the tab again: at the address it was on its way to, or where it is when it was going nowhere. */
  reload?: (to: string | null) => void;
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
 * must neither forget the try nor ask again: that is a tab reloading forever.
 */
let reloading = false;

/** Tests play several page loads in one module. */
export function resetFreshChunkForTests(): void {
  reloading = false;
  goingTo = () => null;
}

const forget = (store: KeyValueStore) => {
  try {
    store.remove(CHUNK_RETRY_KEY);
  } catch {
    // Nothing was kept.
  }
};

/** Reloads the tab once for a chunk that will not come; true when it did. */
export function reloadOnce({
  store = sessionStorageStore,
  reload = reloadTab,
}: FreshDeps = {}): boolean {
  if (tried(store) !== false) return false;
  try {
    store.write(CHUNK_RETRY_KEY, "1");
  } catch {
    return false;
  }
  reloading = true;
  reload(goingTo());
  return true;
}

export function freshChunk<T>(load: () => Promise<T>, deps: FreshDeps = {}): () => Promise<T> {
  const store = deps.store ?? sessionStorageStore;
  return async () => {
    try {
      const chunk = await load();
      if (!reloading) forget(store);
      return chunk;
    } catch (failure) {
      // The page is going away; nothing should draw an error in the meantime.
      if (reloading || reloadOnce({ ...deps, store })) return new Promise<T>(() => undefined);
      forget(store);
      throw failure;
    }
  };
}
