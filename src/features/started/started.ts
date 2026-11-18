import type { KeyValueStore } from "../../lib/storage";
import { decodeGame, EXPIRES_AFTER, playKey } from "../play/savedGames";
import type { Draft } from "../tierboard/draft";
import { KEPT_PREFIX } from "../ranking/kept";

/** Where a draft of somebody else's list is kept: tyl:draft:{list id}. */
const DRAFT_PREFIX = "tyl:draft:";

/** What the list's page reads from Resume game: go straight back into the saved game. */
export const RESUME_GAME = { resumeGame: true } as const;

export const wantsResume = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as { resumeGame?: unknown }).resumeGame === true;

/** What the list's page reads from Save my list in a begun list's menu: saved to one's lists as it opens. */
export const SAVE_MINE = { saveMine: true } as const;

export const wantsSave = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as { saveMine?: unknown }).saveMine === true;

/**
 * Discard my arrangement in a begun list's menu (artboard 39): the draft and
 * a game saved over it go, and the function it gives back puts both back (Undo).
 */
export function discardStarted(store: KeyValueStore, listId: string): () => void {
  const keys = [`${DRAFT_PREFIX}${listId}`, playKey(`list:${listId}`)];
  const kept = keys.map((key) => [key, store.read(key)] as const);
  for (const key of keys) store.remove(key);
  return () => {
    for (const [key, text] of kept) if (text !== null) store.write(key, text);
  };
}

let version = 0;
const listeners = new Set<(here: boolean) => void>();

/** Bumped with every change to the begun lists, for Continue to draw them again. */
export const startedVersion = (): number => version;

export function subscribeStarted(listener: (here: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The begun lists changed: here (`here`, a Discard or its Undo), which the
 * account hears at once, or from the account, which Continue draws.
 */
export function startedChanged(here: boolean): void {
  version++;
  for (const listener of listeners) listener(here);
}

/** How many begun lists "Continue" offers: the latest ones. */
export const CONTINUE_MAX = 3;

/**
 * A list of somebody else's this device began to place and has not put
 * anywhere yet (audit B1): it was only to be found again through Community.
 */
export interface Started {
  listId: string;
  title: string;
  picture: string | null;
  /** The first cards' pictures, at most three; the list's picture when the draft is older. */
  pictures: string[];
  /** Its section's id, when the draft knows it. */
  category: string | null;
  placed: number;
  total: number;
  /** A game over it is saved here: Resume game goes straight back into it. */
  game: boolean;
  savedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A draft as it was stored, read the way the list page reads it: checked, not trusted. */
function readDraft(text: string | null): Partial<Draft> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? (value as Partial<Draft>) : null;
  } catch {
    return null;
  }
}

/** The row's pictures: the first cards', or the one picture an older draft kept. */
function picturesOf(draft: Partial<Draft>): string[] {
  const kept = Array.isArray(draft.pictures)
    ? draft.pictures.filter((url): url is string => typeof url === "string")
    : [];
  if (kept.length > 0) return kept.slice(0, 3);
  return typeof draft.picture === "string" ? [draft.picture] : [];
}

/** A game kept for the list's page, still within its month. */
function hasGame(store: KeyValueStore, listId: string, now: number): boolean {
  const text = store.read(playKey(`list:${listId}`));
  if (text === null) return false;
  const saved = decodeGame(text);
  return saved !== null && now - saved.savedAt <= EXPIRES_AFTER;
}

/**
 * The lists begun here, latest first, at most CONTINUE_MAX: a card placed
 * and the list's name known. A list kept in one's own lists (`saved`) is
 * found there, and one whose ranking was finished here is done; so is one
 * with every card placed: nothing is left to continue (designer 17.11).
 */
export function startedLists(
  store: KeyValueStore,
  saved: ReadonlySet<string>,
  now: number = Date.now(),
): Started[] {
  const found: Started[] = [];
  for (const key of store.keys?.() ?? []) {
    if (!key.startsWith(DRAFT_PREFIX)) continue;
    const listId = key.slice(DRAFT_PREFIX.length);
    if (saved.has(listId) || store.read(`${KEPT_PREFIX}${listId}`) !== null) continue;
    const draft = readDraft(store.read(key));
    if (draft === null || draft.listId !== listId || typeof draft.title !== "string") continue;
    if (!Array.isArray(draft.rows) || typeof draft.itemCount !== "number") continue;
    const placed = draft.rows.reduce(
      (sum: number, row: unknown) => sum + (Array.isArray(row) ? row.length : 0),
      0,
    );
    if (placed === 0 || placed >= draft.itemCount) continue;
    found.push({
      listId,
      title: draft.title,
      picture: typeof draft.picture === "string" ? draft.picture : null,
      pictures: picturesOf(draft),
      category: typeof draft.category === "string" ? draft.category : null,
      placed: Math.min(placed, draft.itemCount),
      total: draft.itemCount,
      game: hasGame(store, listId, now),
      savedAt: typeof draft.savedAt === "number" ? draft.savedAt : 0,
    });
  }
  return found.sort((a, b) => b.savedAt - a.savedAt).slice(0, CONTINUE_MAX);
}
