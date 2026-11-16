import { sessionStorageStore, type KeyValueStore } from "./storage";

/**
 * A page's own piece of the app, fetched when it is first opened. After a
 * deploy, a tab opened before it asks for a file that is no longer there, and
 * the import is rejected. That is not a failure of the site, and it must not
 * look like one (Danylo, 16.11.2026: «просит перезагрузить страницу»): the
 * site is asked which script its front page names now, and when that is not
 * the one this tab started with, a newer release is out and the tab quietly
 * loads it. Once for each release, so a front page that keeps naming another
 * script cannot reload the tab again and again; a tab open through several
 * deploys a day follows each of them.
 *
 * With no newer release, the file is missing for another reason (a dropped
 * connection, a train in a tunnel), and the tab still gets one quiet reload in
 * its life, which cures most of these: any later failure in the same tab is a
 * real one and is let through, to the error page, or to the feature's own word
 * that it could not open.
 *
 * Never under someone's hands: with text being typed or a dialog open, the
 * page stays as it is and the site says it was updated, with Reload.
 */
export const CHUNK_RETRY_KEY = "tyl:chunk-retry";
/** The script of the release this tab last reloaded for. */
export const CHUNK_RELEASE_KEY = "tyl:chunk-release";

export interface FreshDeps {
  store?: KeyValueStore;
  /** Loads the tab again: at the address it was on its way to, or where it is when it was going nowhere. */
  reload?: (to: string | null) => void;
  online?: () => boolean;
  now?: () => number;
  /** Whether the person is in the middle of something a reload would throw away. */
  busy?: () => boolean;
  /** The script this tab started from, as its page names it; null where it names none. */
  ownRelease?: () => string | null;
  /** The script the site's front page names now; null when that cannot be told. */
  liveRelease?: () => Promise<string | null>;
  /** Says that the site was updated, with a way to load it, while the page stays. */
  announce?: () => void;
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

const ENTRY = "script[type='module'][src]";

/** The script a page starts the site from: index.html names one, hashed, per release. */
export function entryOf(doc: Document | DocumentFragment = document): string | null {
  return doc.querySelector<HTMLScriptElement>(ENTRY)?.getAttribute("src") ?? null;
}

/** Asks the site for its front page, past every cache, and reads the script it names. */
export async function liveEntry(): Promise<string | null> {
  try {
    const response = await fetch("/", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    return entryOf(new DOMParser().parseFromString(await response.text(), "text/html"));
  } catch {
    return null;
  }
}

const reloadTab = (to: string | null) => {
  if (to === null) window.location.reload();
  else window.location.assign(to);
};

/** How the site says it was updated; the app tells this module, as it tells it where the tab is going. */
let sayUpdated: () => void = () => undefined;

export function announceWith(say: () => void): void {
  sayUpdated = say;
}

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
const read = (store: KeyValueStore, key: string): string | null | undefined => {
  try {
    return store.read(key);
  } catch {
    return undefined;
  }
};

/**
 * A reload asked for and not yet begun. Vite's own handler for a file that will
 * not come lets the import go on as if nothing happened once the reload is
 * asked for, and what follows (a module that resolved, or one that is empty)
 * must not ask again, nor draw an error on a page about to go.
 */
let reloading = false;
/** One question to the site at a time: a stylesheet and its module failing together ask once. */
let asking: Promise<Recovery> | null = null;
/**
 * Whether the site's front page named another script than this tab's. Once
 * it has, a page that still would not come is this tab being out of date, not
 * a fault: it was reloaded for that release already, or nothing can be kept
 * to remember a reload by, and it says a new version is ready (16.11.2026).
 */
let newer = false;

export function newerRelease(): boolean {
  return newer;
}

/** The failures this module let through, so the error page can tell a chunk that would not come. */
const letThrough = new WeakSet<object>();

/** Whether a route's error is a page's chunk that would not come, after every try here. */
export function isChunkFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && letThrough.has(error);
}

/** Tests play several page loads in one module. */
export function resetFreshChunkForTests(): void {
  reloading = false;
  asking = null;
  newer = false;
  goingTo = () => null;
}

const start = (store: KeyValueStore, key: string, value: string, reload: FreshDeps["reload"]) => {
  try {
    store.write(key, value);
  } catch {
    return false;
  }
  reloading = true;
  (reload ?? reloadTab)(goingTo());
  return true;
};

/** Reloads the tab once in its life for a chunk that will not come; true when it did. */
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
  if (read(store, CHUNK_RETRY_KEY) !== null) return false;
  // Never under someone's hands: what would not open says so, and the work stays.
  if (busy()) return false;
  return start(store, CHUNK_RETRY_KEY, String(now()), reload);
}

/**
 * What became of a chunk that would not come: the tab reloads, the page stays
 * with the word that the site was updated, or the failure is a real one.
 */
export type Recovery = "reloading" | "kept" | "failed";

async function ask(deps: FreshDeps): Promise<Recovery> {
  const {
    store = sessionStorageStore,
    reload = reloadTab,
    online = () => navigator.onLine,
    busy = inTheMiddle,
    ownRelease = () => entryOf(),
    liveRelease = liveEntry,
    announce = sayUpdated,
  } = deps;
  if (!online()) return "failed";
  const own = ownRelease();
  const live = own === null ? null : await liveRelease();
  if (live !== null && live !== own) {
    newer = true;
    // A newer release is out. Reloaded for it already and still on the old
    // one, the site's caches have not caught up: the old rule decides.
    const reloadedFor = read(store, CHUNK_RELEASE_KEY);
    if (reloadedFor !== undefined && reloadedFor !== live) {
      if (busy()) {
        announce();
        return "kept";
      }
      if (start(store, CHUNK_RELEASE_KEY, live, reload)) return "reloading";
    }
  }
  return reloadOnce(deps) ? "reloading" : "failed";
}

/** Finds out why a chunk would not come and does what that calls for. */
export function recover(deps: FreshDeps = {}): Promise<Recovery> {
  if (reloading) return Promise.resolve("reloading");
  asking ??= ask(deps).finally(() => (asking = null));
  return asking;
}

export function freshChunk<T>(load: () => Promise<T>, deps: FreshDeps = {}): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch (failure) {
      // The page is going away, or stays as it was with the word that the
      // site was updated: nothing should draw an error in the meantime.
      if ((await recover(deps)) !== "failed") return new Promise<T>(() => undefined);
      if (typeof failure === "object" && failure !== null) letThrough.add(failure);
      throw failure;
    }
  };
}
