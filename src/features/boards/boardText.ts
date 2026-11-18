import { fill, plural, strings } from "../../strings";
import { isOut, isSavedCopy, poolCount, rankedCount, type Board } from "./model";

/** The board's name, or what an unnamed one is called. */
export const titleOf = (board: Board): string =>
  board.title.trim().length > 0 ? board.title : strings.boards.untitled;

/** The English name a new board is given, kept as it was written whatever the language later. */
const UNTITLED_EN = "Untitled list";

/**
 * A board that still has the name a new one is given, or none: Publish asks
 * for a name before it goes out (audit D1), or Community fills with them.
 */
export const isUntitled = (board: Board): boolean => {
  const title = board.title.trim();
  return title === "" || title === strings.boards.untitled || title === UNTITLED_EN;
};

/** Where a conflict's copy came from, "from Pixel 7"; null for a board that is no such copy. */
export const fromOf = (board: Board): string | null =>
  board.arrivedFrom === null ? null : fill(strings.sync.arrivedFrom, { device: board.arrivedFrom });

/** The name a screen reader hears: a conflict's copy says where it came from, or it would sound like its original. */
export function spokenTitleOf(board: Board): string {
  const from = fromOf(board);
  return from === null ? titleOf(board) : `${titleOf(board)}, ${from}`;
}

/**
 * The label before a list's count in Your lists (artboard 42): Public for one
 * out in Community, Saved for a copy of somebody else's, none for one's own.
 */
export function labelOf(board: Board): string | null {
  if (isOut(board)) return strings.listMenu.publicLabel;
  return isSavedCopy(board) ? strings.listMenu.savedLabel : null;
}

/**
 * How far along it is, as the phone's artboard 9 says it: "25 cards · 12
 * placed", or "1 card · nothing placed yet" (audit E2: no pool, no ranked).
 */
export function metaOf(board: Board): string {
  const placed = rankedCount(board);
  const cards = plural(strings.boards.cards, placed + poolCount(board));
  return `${cards} · ${placed === 0 ? strings.boards.nothingRanked : plural(strings.boards.ranked, placed)}`;
}
