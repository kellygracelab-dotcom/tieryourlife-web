import type { PublishedList } from "../../api/types";
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
  const title = board.title.trim().length > 0 ? board.title : untitled;
  return {
    list: {
      id: board.uid,
      title,
      authorUid: "",
      authorName: board.authorName ?? "",
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
        tierIndex: rows.findIndex((row) => row.includes(position)) === -1 ? null : undefined,
      })),
    },
    uids,
    rows,
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
