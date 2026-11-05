/**
 * A place to keep a few strings by key: the browser's storage, or a map for
 * what must not outlive the page. Everything the site remembers on a device
 * goes through this shape, so a test can hand in a map instead.
 */
export interface KeyValueStore {
  read(key: string): string | null;
  /** False when the value could not be kept; a store that cannot fail returns nothing. */
  write(key: string, value: string): boolean | void;
  remove(key: string): void;
  keys?(): string[];
}

/** A store that forgets on reload, for what must not outlive the page. */
export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      data.set(key, value);
      return true;
    },
    remove: (key) => void data.delete(key),
    keys: () => [...data.keys()],
  };
}

/**
 * Whether this browser refused to keep something the site wrote: its storage
 * is full or blocked. Said once on screen, so nobody goes on making lists
 * that are not being kept.
 */
let refused = false;
const troubleListeners = new Set<() => void>();

export const storageRefused = (): boolean => refused;

export function subscribeToStorageTrouble(listener: () => void): () => void {
  troubleListeners.add(listener);
  return () => troubleListeners.delete(listener);
}

function noteRefusal(): void {
  if (refused) return;
  refused = true;
  troubleListeners.forEach((listener) => listener());
}

/** What each browser store was refused, kept for the visit instead. */
const refusedWrites = new Set<Map<string, string>>();

export function resetStorageTroubleForTests(): void {
  refused = false;
  refusedWrites.forEach((held) => held.clear());
}

// Private mode, a full disk and a browser told to block storage all throw;
// the site must work anyway, it just forgets on reload, and says so. What
// the browser would not keep is held here for the visit, so a list made now
// still has its title and its cards until the tab goes.
function browserStore(storage: () => Storage): KeyValueStore {
  const held = new Map<string, string>();
  refusedWrites.add(held);
  return {
    read(key) {
      const kept = held.get(key);
      if (kept !== undefined) return kept;
      try {
        return storage().getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        storage().setItem(key, value);
        held.delete(key);
        return true;
      } catch {
        held.set(key, value);
        noteRefusal();
        return false;
      }
    },
    remove(key) {
      held.delete(key);
      try {
        storage().removeItem(key);
      } catch {
        /* nothing to remove */
      }
    },
    keys() {
      let stored: string[] = [];
      try {
        stored = Object.keys(storage());
      } catch {
        // Blocked: only what this visit holds.
      }
      return [...new Set([...stored, ...held.keys()])];
    },
  };
}

/** Kept on this device until the person clears it. */
export const localStorageStore: KeyValueStore = browserStore(() => window.localStorage);

/** Kept for as long as the tab lives: a reload remembers, a new tab does not. */
export const sessionStorageStore: KeyValueStore = browserStore(() => window.sessionStorage);
