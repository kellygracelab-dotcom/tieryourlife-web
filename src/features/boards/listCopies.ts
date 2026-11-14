import type { PublishedList } from "../../api/types";
import type { KeyValueStore } from "../../lib/storage";
import type { Rows } from "../tierboard/model";
import {
  arrangeItems,
  isOut,
  liveItems,
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
 * The copies one too many: for each list saved more than once, every copy
 * but the one kept. A copy out in the list's Rankings is never one of them,
 * nor are the copies of a list one of whose copies the person brought back
 * from the trash after it was tidied away: two of them is their choice.
 */
export function extraCopies(boards: readonly Board[], spared: ReadonlySet<string>): Board[] {
  const byList = new Map<string, Board[]>();
  for (const board of boards) {
    if (!isLiveCopy(board) || board.takenFrom === null) continue;
    byList.set(board.takenFrom, [...(byList.get(board.takenFrom) ?? []), board]);
  }
  const extra: Board[] = [];
  for (const copies of byList.values()) {
    if (copies.length < 2 || copies.some((board) => spared.has(board.uid))) continue;
    const [, ...rest] = [...copies].sort(keeperFirst);
    extra.push(...rest.filter((board) => !isOut(board)));
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
