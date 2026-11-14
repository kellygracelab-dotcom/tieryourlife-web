import type { PublishedList } from "../../api/types";
import type { KeyValueStore } from "../../lib/storage";
import type { Rows } from "../tierboard/model";
import {
  arrangeItems,
  isOut,
  itemsIn,
  liveItems,
  poolTier,
  rankedCount,
  rankedTiers,
  trashBoard,
  type Board,
} from "./model";
import type { BoardsRepository } from "./repository";
import { rowsOfSource, sourceIndexes } from "./sourceRanking";

/**
 * Somebody else's list saved to one's lists: a board that came from it, not
 * the board one's own list was published from, and not in the trash. One
 * list is one such board, as on the phone (Danylo, 14.11.2026).
 */
const isLiveCopy = (board: Board): boolean =>
  board.deletedAt === null && board.takenFrom !== null && board.publishedId === null;

/**
 * Of two copies of one list, the one to keep first: one out in the list's
 * Rankings, then the one with more cards placed (the person's work, the same
 * on every device), then more cards, then the one edited last here (a time
 * this device keeps, so only a tie-break), then the uid, so every device
 * picks the same.
 */
const keeperFirst = (a: Board, b: Board): number =>
  Number(isOut(b)) - Number(isOut(a)) ||
  rankedCount(b) - rankedCount(a) ||
  liveItems(b).length - liveItems(a).length ||
  b.editedAt - a.editedAt ||
  a.uid.localeCompare(b.uid);

/** The board this person saved the list to, or null when they have not. */
export function copyOfList(boards: readonly Board[], listId: string): Board | null {
  return (
    boards
      .filter((board) => isLiveCopy(board) && board.takenFrom === listId)
      .sort(keeperFirst)[0] ?? null
  );
}

/**
 * A board of one's own that only a list's copy can be the same as: in one's
 * lists, never published, no ranking of anybody's, with cards on it.
 */
const isLooseBoard = (board: Board): boolean =>
  board.deletedAt === null &&
  board.takenFrom === null &&
  board.publishedId === null &&
  board.rankingOf === null &&
  liveItems(board).length > 0;

const words = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

/**
 * What makes two boards the same list, pictures aside: the title, each tier's
 * word with its cards by title in their order, and the pool's cards.
 */
function contentOf(board: Board): string {
  const pool = poolTier(board);
  return JSON.stringify([
    words(board.title),
    rankedTiers(board).map((tier) => [
      words(tier.label),
      itemsIn(board, tier.uid).map((card) => words(card.title)),
    ]),
    pool === null
      ? []
      : itemsIn(board, pool.uid)
          .map((card) => words(card.title))
          .sort(),
  ]);
}

/**
 * Whether a board has no picture of its own beside another's: none uploaded,
 * and each picture it shows, the cover's too, one the other board has.
 */
function picturesWithin(board: Board, other: Board): boolean {
  const theirs = new Set(
    [other.coverImageUrl, ...liveItems(other).map((card) => card.imageUrl)].filter(
      (url): url is string => url !== null,
    ),
  );
  return (
    board.coverPictureId === null &&
    (board.coverImageUrl === null || theirs.has(board.coverImageUrl)) &&
    liveItems(board).every(
      (card) => card.pictureId === null && (card.imageUrl === null || theirs.has(card.imageUrl)),
    )
  );
}

const editedLast = (a: Board, b: Board): number =>
  b.editedAt - a.editedAt || a.uid.localeCompare(b.uid);

/**
 * The copies one too many: for each list saved more than once, every copy
 * but the one kept. A copy out in the list's Rankings is never one of them,
 * nor are the copies of a list one of whose copies the person brought back
 * from the trash after it was tidied away: two of them is their choice.
 *
 * A board that lost its tie to the list is one of them too when it is the
 * same list as a copy (Eurovision in Danylo's lists again, 14.11.2026, a
 * board of text cards from an old Publish): the same title and the same
 * cards by title in the same tiers, and no picture of its own. Two such
 * boards with no copy keep the one edited last. Any difference, and the
 * board stays.
 */
export function extraCopies(boards: readonly Board[], spared: ReadonlySet<string>): Board[] {
  const byList = new Map<string, Board[]>();
  for (const board of boards) {
    if (!isLiveCopy(board) || board.takenFrom === null) continue;
    byList.set(board.takenFrom, [...(byList.get(board.takenFrom) ?? []), board]);
  }
  const loose = new Map<string, Board[]>();
  for (const board of boards) {
    if (!isLooseBoard(board)) continue;
    const content = contentOf(board);
    loose.set(content, [...(loose.get(content) ?? []), board]);
  }
  const extra: Board[] = [];
  for (const copies of byList.values()) {
    const kept = [...copies].sort(keeperFirst);
    const same = kept.flatMap((copy) => loose.get(contentOf(copy)) ?? []);
    if ([...copies, ...same].some((board) => spared.has(board.uid))) continue;
    extra.push(...kept.slice(1).filter((board) => !isOut(board)));
    // Gone from the loose ones either way: a copy of the list has them.
    for (const board of new Set(same)) {
      loose.delete(contentOf(board));
      if (kept.some((copy) => picturesWithin(board, copy))) extra.push(board);
    }
  }
  for (const group of loose.values()) {
    if (group.length < 2 || group.some((board) => spared.has(board.uid))) continue;
    const [keeper, ...rest] = [...group].sort(editedLast);
    if (keeper === undefined) continue;
    extra.push(...rest.filter((board) => picturesWithin(board, keeper)));
  }
  return extra;
}

/** Where this browser remembers the copies it tidied away for an account, or for nobody. */
export const tidiedKey = (owner: string | null): string =>
  "tyl:copies-tidied:" + JSON.stringify([owner]);

function tidiedIn(store: KeyValueStore, owner: string | null): string[] {
  try {
    const kept: unknown = JSON.parse(store.read(tidiedKey(owner)) ?? "[]");
    return Array.isArray(kept) ? kept.filter((uid): uid is string => typeof uid === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A list saved twice before saving reused the copy it had (Eurovision in
 * Danylo's lists, 14.11.2026): the extra copies go to the trash, where they
 * can be brought back, and nothing else does. Each is tidied once: brought
 * back, it stays. Returns the uids it moved.
 */
export function tidyCopies(
  repository: BoardsRepository,
  store: KeyValueStore,
  owner: string | null,
  now: number,
): string[] {
  const before = tidiedIn(store, owner);
  const extra = extraCopies(repository.all(), new Set(before));
  if (extra.length === 0) return [];
  repository.saveAll(extra.map((board) => trashBoard(board, now)));
  const uids = extra.map((board) => board.uid);
  store.write(tidiedKey(owner), JSON.stringify([...before, ...uids]));
  return uids;
}

/**
 * Mine as the saved board holds the list (QA, 14.11.2026: the list's page
 * showed 0 of 31 over a copy with 13 placed): the list's cards by their place
 * in it, in the board's tiers, and the pool in the board's order. Null when
 * the board is no longer the list's, or places nothing.
 */
export function mineOfCopy(
  copy: Board,
  list: PublishedList,
): { rows: number[][]; poolOrder: number[] } | null {
  const at = sourceIndexes(copy, list);
  const rows = rowsOfSource(copy, list);
  if (at === null || rows === null || !rows.some((row) => row.length > 0)) return null;
  const pool = poolTier(copy);
  const poolOrder =
    pool === null ? [] : itemsIn(copy, pool.uid).flatMap((card) => at.get(card.uid) ?? []);
  return { rows, poolOrder };
}

/** Rows of a list's card numbers as they read placed: a missing arrangement places nothing. */
const placedRows = (list: PublishedList, rows: Rows | null): number[][] =>
  list.tiers.map((_, tier) => [...(rows?.[tier] ?? [])]);

/**
 * Whether the copy already holds this arrangement of the list. A copy that is
 * no longer the list's cards and tiers (renamed, a card of one's own added)
 * is the person's own work now, and reads as saved: Save opens it rather than
 * putting the list's arrangement over it.
 */
export function holdsArrangement(copy: Board, list: PublishedList, rows: Rows | null): boolean {
  const held = rowsOfSource(copy, list);
  return held === null || JSON.stringify(held) === JSON.stringify(placedRows(list, rows));
}

/**
 * The same copy with the list's cards placed as these rows say, the cards
 * of its own where they are; null when the copy is no longer the list's.
 */
export function rearrangeCopy(
  copy: Board,
  list: PublishedList,
  rows: Rows | null,
  now: number,
): Board | null {
  const at = sourceIndexes(copy, list);
  if (at === null) return null;
  const uidOf = new Map([...at].map(([uid, index]) => [index, uid]));
  const wanted = placedRows(list, rows);
  const uidRows = rankedTiers(copy).map((_, tier) =>
    (wanted[tier] ?? []).flatMap((index) => {
      const uid = uidOf.get(index);
      return uid === undefined ? [] : [uid];
    }),
  );
  return arrangeItems(copy, uidRows, now);
}
