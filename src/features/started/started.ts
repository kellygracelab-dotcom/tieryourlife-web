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
 * found there, and one whose ranking was finished here is done.
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
    if (placed === 0) continue;
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
