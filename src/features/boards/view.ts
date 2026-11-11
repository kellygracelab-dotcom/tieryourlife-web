import type { PublishedItem, PublishedList, PublishedTier } from "../../api/types";
import {
  itemsIn,
  poolTier,
  previewsOf,
  rankedTiers,
  type Board,
  type BoardItem,
  type BoardTier,
} from "./model";

/**
 * A board the way the ranking board draws one: the list's shape (cards and
 * tiers by index) and one row of card indexes per tier. The uids are kept
 * beside, so a move reported by index can be written back to the board.
 */
export interface BoardView {
  list: PublishedList;
  uids: string[];
  rows: number[][];
  pool: number[];
}

const publishedTier = (tier: BoardTier) => ({
  label: tier.label,
  caption: tier.caption,
  colorLight: tier.colorLight,
  colorDark: tier.colorDark,
});

/**
 * The cards in tier order, then the pool's. Given the order of the view the
 * page drew before, and the same cards, that order stays: the ranking board
 * holds its rows by index, and a move that renumbered the cards had a card
 * moved along its row draw another card in its place.
 */
export function boardView(board: Board, untitled: string, before?: readonly string[]): BoardView {
  const tiers = rankedTiers(board);
  const pool = poolTier(board);
  const inRows: BoardItem[][] = tiers.map((tier) => itemsIn(board, tier.uid));
  const inPool = pool === null ? [] : itemsIn(board, pool.uid);
  const fresh = [...inRows.flat(), ...inPool];
  const byUid = new Map(fresh.map((item) => [item.uid, item]));
  const kept = before?.flatMap((uid) => byUid.get(uid) ?? []);
  const ordered = kept !== undefined && kept.length === fresh.length ? kept : fresh;
  const uids = ordered.map((item) => item.uid);
  const indexOf = new Map(uids.map((uid, index) => [uid, index]));
  const rows = inRows.map((row) => row.flatMap((item) => indexOf.get(item.uid) ?? []));
  const placed = new Set(rows.flat());
  const title = board.title.trim().length > 0 ? board.title : untitled;
  return {
    list: {
      id: board.uid,
      title,
      authorUid: "",
      // An anonymous list names nobody, on its page or on any picture of it.
      authorName: board.anonymous ? "" : (board.authorName ?? ""),
      authorPhotoUrl: null,
      category: board.category ?? "other",
      itemCount: ordered.length,
      coverImageUrl: board.coverImageUrl,
      previewImages: previewsOf(board),
      tierColors: tiers.map((tier) => tier.colorLight),
      updatedAt: board.editedAt,
      takeCount: 0,
      tiers: tiers.map(publishedTier),
      items: ordered.map((item, position) => ({
        title: item.title,
        imageUrl: item.imageUrl,
        credit: item.credit,
        tierIndex: placed.has(position) ? undefined : null,
      })),
    },
    uids,
    rows,
    pool: inPool.map((item) => indexOf.get(item.uid)!),
  };
}

const sameItem = (a: PublishedItem, b: PublishedItem): boolean =>
  a.title === b.title &&
  a.imageUrl === b.imageUrl &&
  a.credit === b.credit &&
  a.tierIndex === b.tierIndex;

const sameTier = (a: PublishedTier, b: PublishedTier): boolean =>
  a.label === b.label &&
  a.caption === b.caption &&
  a.colorLight === b.colorLight &&
  a.colorDark === b.colorDark;

/**
 * The view, with the cards and tiers of the one drawn before wherever they
 * read the same. Every move rewrites the board and so the view; the ranking
 * board draws a card again only when the card it is handed is another, so
 * a move on a board of 2,000 cards draws the card moved, not all of them.
 */
export function keepUnchanged(before: BoardView | null, next: BoardView): BoardView {
  if (before === null) return next;
  const old = before.list;
  const items = next.list.items.map((item, index) => {
    const was = old.items[index];
    return was !== undefined && sameItem(was, item) ? was : item;
  });
  const sameItems =
    items.length === old.items.length && items.every((item, i) => item === old.items[i]);
  const sameTiers =
    next.list.tiers.length === old.tiers.length &&
    next.list.tiers.every((tier, i) => old.tiers[i] !== undefined && sameTier(old.tiers[i], tier));
  return {
    ...next,
    list: {
      ...next.list,
      items: sameItems ? old.items : items,
      tiers: sameTiers ? old.tiers : next.list.tiers,
    },
  };
}

/** Whether two orders of cards are one and the same. */
export const sameOrder = (a: readonly string[], b: readonly string[] | undefined): boolean =>
  b !== undefined && a.length === b.length && a.every((uid, index) => uid === b[index]);

/** Rows of indexes, as the board reports them, back to rows of uids. */
export const uidRows = (view: BoardView, rows: readonly (readonly number[])[]): string[][] =>
  rows.map((row) =>
    row.flatMap((index) => (view.uids[index] === undefined ? [] : [view.uids[index]])),
  );

/**
 * Where every card stands, as one string: the board on screen holds its rows
 * itself, so a change of it written elsewhere (another tab, the account's
 * copy coming down) has to be told from the board's own.
 */
export function arrangementOf(board: Board): string {
  const pool = poolTier(board);
  const rows = [...rankedTiers(board), ...(pool === null ? [] : [pool])];
  return JSON.stringify(rows.map((tier) => itemsIn(board, tier.uid).map((item) => item.uid)));
}
