import { sessionStorageStore, type KeyValueStore } from "../../lib/storage";

/**
 * A guest's draft card from a link, kept while the sign-in leaves the page
 * through a redirect: the board they come back to opens it again, with the
 * same name, link and page, and keeps the picture then. A popup's sign-in
 * keeps the page, and the draft with it.
 */
export interface DraftToResume {
  /** The board's page, so another board does not take it. */
  path: string;
  url: string;
  name: string;
  page: string;
}

const KEY = "tyl:draftAfterSignIn";
/** A sign-in that went away and came back is minutes, not hours. */
export const DRAFT_LASTS_MS = 10 * 60 * 1000;

let store: KeyValueStore = sessionStorageStore;

/** Tests keep their own store; the page keeps the tab's. */
export function draftStoreForTests(replacement: KeyValueStore): void {
  store = replacement;
}

export function keepDraftForSignIn(draft: DraftToResume, now = Date.now()): void {
  store.write(KEY, JSON.stringify({ ...draft, at: now }));
}

export function forgetDraftForSignIn(): void {
  store.remove(KEY);
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The draft kept for this board's page, if there is one still fresh. */
export function draftForSignIn(path: string, now = Date.now()): DraftToResume | null {
  let kept: unknown;
  try {
    kept = JSON.parse(store.read(KEY) ?? "null");
  } catch {
    kept = null;
  }
  if (typeof kept !== "object" || kept === null) return null;
  const value = kept as Record<string, unknown>;
  if (typeof value.at !== "number" || now - value.at > DRAFT_LASTS_MS) {
    store.remove(KEY);
    return null;
  }
  if (value.path !== path || text(value.url) === "") return null;
  return { path, url: text(value.url), name: text(value.name), page: text(value.page) };
}

/** The draft kept for this board's page, taken: asked once, it is forgotten. */
export function takeDraftForSignIn(path: string, now = Date.now()): DraftToResume | null {
  const draft = draftForSignIn(path, now);
  if (draft !== null) store.remove(KEY);
  return draft;
}
