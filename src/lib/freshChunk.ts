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
  reload?: () => void;
  online?: () => boolean;
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
  reload = () => window.location.reload(),
  online = () => navigator.onLine,
}: FreshDeps = {}): boolean {
  // Offline the file is missing for want of a connection, not for a deploy,
  // and a reload would only trade the whole site for the browser's own error
  // page: the page that would not open says so instead, in the site.
  if (!online()) return false;
  if (tried(store) !== false) return false;
  try {
    store.write(CHUNK_RETRY_KEY, "1");
  } catch {
    return false;
  }
  reloading = true;
  reload();
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
