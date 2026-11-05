import type { SyncedPlay } from "../../api/boards";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import {
  creditOf,
  DISPLAY_MODES,
  POOL_COLOURS,
  POOL_LABEL,
  type Board,
  type BoardItem,
  type BoardTier,
  type BoardTopic,
  type DisplayMode,
} from "./model";

/**
 * Where this device keeps its boards: one key per board, so a board is read
 * and written whole and two boards never share a write. Pages read through
 * the hooks in useBoards.ts; nothing else touches the keys.
 */
export const BOARD_PREFIX = "tyl:board:";

export const boardKey = (uid: string): string => `${BOARD_PREFIX}${uid}`;

/**
 * Boards edited for the house, kept apart from one's own: on this device
 * only, never synced to the account, never in Your lists. A house list
 * belongs to the admin panel, not to whoever edits it (Danylo, 03.11.2026).
 */
export const HOUSE_BOARD_PREFIX = "tyl:houseBoard:";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const time = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
const hex = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

function tierOf(raw: unknown, position: number): BoardTier | null {
  if (raw === null || typeof raw !== "object") return null;
  const tier = raw as Record<string, unknown>;
  const uid = text(tier.uid);
  if (uid === null || uid.length === 0) return null;
  const isPool = tier.isPool === true;
  const label = text(tier.label) ?? "";
  return {
    uid,
    position: typeof tier.position === "number" ? tier.position : position,
    // This site once kept its pools nameless, and the account refused them.
    label: isPool && label.trim().length === 0 ? POOL_LABEL : label,
    caption: text(tier.caption),
    colorLight: hex(tier.colorLight, POOL_COLOURS.colorLight),
    colorDark: hex(tier.colorDark, POOL_COLOURS.colorDark),
    isPool,
  };
}

/**
 * The phone's name for the mode, or the default. "RANKED" is what this site
 * wrote for the ranked column before it used the phone's names, which the
 * phone read as rows.
 */
function displayModeOf(raw: unknown): DisplayMode {
  if (raw === "RANKED") return "FLAT_RANKED";
  return DISPLAY_MODES.find((mode) => mode === raw) ?? "WRAP";
}

const KINDS: readonly string[] = ["swiss", "hill", "bracket"];
const isInt = (value: unknown): value is number => Number.isInteger(value);

/**
 * A saved game from the account or this device, or null for anything that
 * is not one: a game that does not hold together is dropped, and the board
 * kept, as the backend does.
 */
export function playOf(raw: unknown): SyncedPlay | null {
  if (raw === null || typeof raw !== "object") return null;
  const play = raw as Record<string, unknown>;
  const { kind, count, seed, refine, ids, history, round, startedAt, scope, keepTier } = play;
  if (typeof kind !== "string" || !KINDS.includes(kind)) return null;
  if (!isInt(count) || !isInt(seed) || typeof refine !== "boolean") return null;
  if (!isInt(round) || typeof startedAt !== "number") return null;
  if (!Array.isArray(ids) || ids.length !== count || !ids.every((id) => typeof id === "string")) {
    return null;
  }
  const inGame = (n: unknown): n is number => isInt(n) && n >= 0 && n < count;
  if (
    !Array.isArray(history) ||
    !history.every(
      (answer) =>
        Array.isArray(answer) &&
        answer.length === 3 &&
        inGame(answer[0]) &&
        inGame(answer[1]) &&
        (answer[2] === null || inGame(answer[2])),
    )
  ) {
    return null;
  }
  const tiers =
    Array.isArray(scope) && scope.length > 0 && scope.every((uid) => typeof uid === "string")
      ? (scope as string[])
      : null;
  return {
    kind: kind as SyncedPlay["kind"],
    count,
    seed,
    refine,
    ids: ids as string[],
    history: history as SyncedPlay["history"],
    round,
    startedAt,
    ...(tiers === null ? {} : { scope: tiers }),
    ...(tiers !== null && tiers.length === 1 && keepTier === true
      ? { keepTier: true as const }
      : {}),
  };
}

function topicOf(raw: unknown): BoardTopic | null {
  if (raw === null || typeof raw !== "object") return null;
  const topic = raw as Record<string, unknown>;
  const id = text(topic.id);
  const name = text(topic.name);
  if (name === null || id === "") return null;
  // No id is a name proposed here and not sent yet: it needs a name to be anything.
  if (id === null) return name.trim() === "" ? null : { id: null, name };
  return topic.waiting === true ? { id, name, waiting: true } : { id, name };
}

function itemOf(raw: unknown, tierUids: Set<string>, position: number): BoardItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const uid = text(item.uid);
  const tierUid = text(item.tierUid);
  const title = text(item.title);
  if (uid === null || uid.length === 0 || tierUid === null || !tierUids.has(tierUid)) return null;
  if (title === null) return null;
  const source = item.source;
  return {
    uid,
    pictureId: text(item.pictureId),
    tierUid,
    position: typeof item.position === "number" ? item.position : position,
    title,
    imageUrl: text(item.imageUrl),
    credit: creditOf(item.credit),
    source: source === "TMDB" || source === "GENERATED" ? source : "MANUAL",
    deletedAt: time(item.deletedAt),
  };
}

/**
 * A board as kept, or by this device's older self or by the account; what
 * does not parse is left out rather than guessed at. A board with no pool is
 * given one, since every move needs somewhere to put a card.
 */
export function parseBoard(raw: unknown): Board | null {
  if (raw === null || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const uid = text(source.uid);
  if (uid === null || uid.length === 0 || !Array.isArray(source.tiers)) return null;
  const tiers = source.tiers
    .map((tier, index) => tierOf(tier, index))
    .filter((tier): tier is BoardTier => tier !== null);
  if (tiers.length === 0) return null;
  if (!tiers.some((tier) => tier.isPool)) {
    tiers.push({
      uid: `${uid}:pool`,
      position: tiers.length,
      label: POOL_LABEL,
      caption: null,
      ...POOL_COLOURS,
      isPool: true,
    });
  }
  const tierUids = new Set(tiers.map((tier) => tier.uid));
  const items = (Array.isArray(source.items) ? source.items : [])
    .map((item, index) => itemOf(item, tierUids, index))
    .filter((item): item is BoardItem => item !== null);
  const category = text(source.category);
  return {
    uid,
    title: text(source.title) ?? "",
    displayMode: displayModeOf(source.displayMode),
    // Any section's id stays, one the site does not know yet too: read as
    // none, it would go back to the account as none and unfile the list there.
    category: category === null || category === "" ? null : category,
    coverImageUrl: text(source.coverImageUrl),
    coverImageUrls: Array.isArray(source.coverImageUrls)
      ? source.coverImageUrls.filter((url): url is string => typeof url === "string")
      : [],
    authorName: text(source.authorName),
    publishedId: text(source.publishedId),
    takenFrom: text(source.takenFrom),
    rankingOf: text(source.rankingOf),
    deletedAt: time(source.deletedAt),
    tiers,
    items,
    editedAt: time(source.editedAt) ?? 0,
    favouritedAt: time(source.favouritedAt),
    arrivedFrom: text(source.arrivedFrom),
    publishedEditedAt: time(source.publishedEditedAt),
    topic: topicOf(source.topic),
    anonymous: source.anonymous === true,
    play: playOf(source.play),
  };
}

export interface BoardsRepository {
  /** Every board kept here, trash included, in no particular order. The same array until something changes. */
  all(): readonly Board[];
  get(uid: string): Board | null;
  /** False when the browser would not keep it: its storage is full or blocked. */
  save(board: Board): boolean;
  saveAll(boards: readonly Board[]): void;
  /** Gone for good; the trash is a time on the board, not this. */
  remove(uid: string): void;
  /** Read again: its keys were written from outside it. */
  reread(): void;
  subscribe(listener: () => void): () => void;
}

export function boardsRepository(
  store: KeyValueStore,
  prefix: string = BOARD_PREFIX,
): BoardsRepository {
  const keyOf = (uid: string): string => `${prefix}${uid}`;
  const listeners = new Set<() => void>();
  let snapshot: readonly Board[] | null = null;
  // Each board as last parsed, by the text it was parsed from: a board that did
  // not change is the same object after another one's save, so the shelf draws
  // again only the tile that changed, and only that one is parsed again.
  let parsed = new Map<string, { raw: string; board: Board }>();

  const read = (): readonly Board[] => {
    const keys = (store.keys?.() ?? []).filter((key) => key.startsWith(prefix));
    const boards: Board[] = [];
    const next = new Map<string, { raw: string; board: Board }>();
    for (const key of keys) {
      const raw = store.read(key);
      if (raw === null) continue;
      const known = parsed.get(key);
      if (known !== undefined && known.raw === raw) {
        next.set(key, known);
        boards.push(known.board);
        continue;
      }
      try {
        const board = parseBoard(JSON.parse(raw));
        if (board !== null) {
          next.set(key, { raw, board });
          boards.push(board);
        }
      } catch {
        // A key that no longer parses is somebody else's; it is left as it is.
      }
    }
    parsed = next;
    return boards;
  };

  const changed = () => {
    snapshot = null;
    listeners.forEach((listener) => listener());
  };

  // Another tab of the site may have written a board; the browser says so.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) changed();
  };

  return {
    all() {
      snapshot ??= read();
      return snapshot;
    },
    get(uid) {
      return this.all().find((board) => board.uid === uid) ?? null;
    },
    save(board) {
      const kept = store.write(keyOf(board.uid), JSON.stringify(board)) !== false;
      changed();
      return kept;
    },
    saveAll(boards) {
      for (const board of boards) store.write(keyOf(board.uid), JSON.stringify(board));
      changed();
    },
    remove(uid) {
      store.remove(keyOf(uid));
      changed();
    },
    reread: changed,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        // Nobody listened for the other tabs meanwhile: what was read then may be old now.
        snapshot = null;
        if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          snapshot = null;
          if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
        }
      };
    },
  };
}

/** The boards this browser edits for the house; nothing syncs them. */
export const houseBoards: BoardsRepository = boardsRepository(
  localStorageStore,
  HOUSE_BOARD_PREFIX,
);
