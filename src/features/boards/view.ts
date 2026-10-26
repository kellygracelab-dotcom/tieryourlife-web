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

export function boardView(board: Board, untitled: string): BoardView {
  const tiers = rankedTiers(board);
  const pool = poolTier(board);
  const inRows: BoardItem[][] = tiers.map((tier) => itemsIn(board, tier.uid));
  const inPool = pool === null ? [] : itemsIn(board, pool.uid);
  const ordered = [...inRows.flat(), ...inPool];
  const uids = ordered.map((item) => item.uid);
  let index = 0;
  const rows = inRows.map((row) => row.map(() => index++));
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

/** Rows of indexes, as the board reports them, back to rows of uids. */
export const uidRows = (view: BoardView, rows: readonly (readonly number[])[]): string[][] =>
  rows.map((row) =>
    row.flatMap((index) => (view.uids[index] === undefined ? [] : [view.uids[index]])),
  );

/**
 * A brand-new board nobody has touched: no cards, the name it was given, and
 * no edit since it was made. Leaving one behind would strand an Untitled
 * list, so the page throws it away, the way the phone's cross does.
 */
export const isUntouched = (board: Board, openedAt: number, untitled: string): boolean =>
  board.items.length === 0 &&
  board.editedAt === openedAt &&
  board.favouritedAt === null &&
  (board.title === untitled || board.title.trim().length === 0);
