import { isCategory } from "../../api/types";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { POOL_COLOURS, type Board, type BoardItem, type BoardTier } from "./model";

/**
 * Where this device keeps its boards: one key per board, so a board is read
 * and written whole and two boards never share a write. Pages read through
 * the hooks in useBoards.ts; nothing else touches the keys.
 */
export const BOARD_PREFIX = "tyl:board:";

export const boardKey = (uid: string): string => `${BOARD_PREFIX}${uid}`;

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
  return {
    uid,
    position: typeof tier.position === "number" ? tier.position : position,
    label: text(tier.label) ?? "",
    caption: text(tier.caption),
    colorLight: hex(tier.colorLight, POOL_COLOURS.colorLight),
    colorDark: hex(tier.colorDark, POOL_COLOURS.colorDark),
    isPool: tier.isPool === true,
  };
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
      label: "",
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
    displayMode: source.displayMode === "RANKED" ? "RANKED" : "WRAP",
    category: category !== null && isCategory(category) ? category : null,
    coverImageUrl: text(source.coverImageUrl),
    coverImageUrls: Array.isArray(source.coverImageUrls)
      ? source.coverImageUrls.filter((url): url is string => typeof url === "string")
      : [],
    authorName: text(source.authorName),
    publishedId: text(source.publishedId),
    deletedAt: time(source.deletedAt),
    tiers,
    items,
    editedAt: time(source.editedAt) ?? 0,
    favouritedAt: time(source.favouritedAt),
    arrivedFrom: text(source.arrivedFrom),
  };
}

export interface BoardsRepository {
  /** Every board kept here, trash included, in no particular order. The same array until something changes. */
  all(): readonly Board[];
  get(uid: string): Board | null;
  save(board: Board): void;
  saveAll(boards: readonly Board[]): void;
  /** Gone for good; the trash is a time on the board, not this. */
  remove(uid: string): void;
  subscribe(listener: () => void): () => void;
}

export function boardsRepository(store: KeyValueStore): BoardsRepository {
  const listeners = new Set<() => void>();
  let snapshot: readonly Board[] | null = null;

  const read = (): readonly Board[] => {
    const keys = (store.keys?.() ?? []).filter((key) => key.startsWith(BOARD_PREFIX));
    const boards: Board[] = [];
    for (const key of keys) {
      const raw = store.read(key);
      if (raw === null) continue;
      try {
        const board = parseBoard(JSON.parse(raw));
        if (board !== null) boards.push(board);
      } catch {
        // A key that no longer parses is somebody else's; it is left as it is.
      }
    }
    return boards;
  };

  const changed = () => {
    snapshot = null;
    listeners.forEach((listener) => listener());
  };

  // Another tab of the site may have written a board; the browser says so.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(BOARD_PREFIX)) changed();
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
      store.write(boardKey(board.uid), JSON.stringify(board));
      changed();
    },
    saveAll(boards) {
      for (const board of boards) store.write(boardKey(board.uid), JSON.stringify(board));
      changed();
    },
    remove(uid) {
      store.remove(boardKey(uid));
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
  };
}

/** The site's own: this browser's boards. */
export const boards: BoardsRepository = boardsRepository(localStorageStore);
