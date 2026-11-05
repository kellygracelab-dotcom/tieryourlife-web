import { fill, plural, strings } from "../../strings";
import { poolCount, rankedCount, type Board } from "./model";

/** The board's name, or what an unnamed one is called. */
export const titleOf = (board: Board): string =>
  board.title.trim().length > 0 ? board.title : strings.boards.untitled;

/** Where a conflict's copy came from, "from Pixel 7"; null for a board that is no such copy. */
export const fromOf = (board: Board): string | null =>
  board.arrivedFrom === null ? null : fill(strings.sync.arrivedFrom, { device: board.arrivedFrom });

/** The name a screen reader hears: a conflict's copy says where it came from, or it would sound like its original. */
export function spokenTitleOf(board: Board): string {
  const from = fromOf(board);
  return from === null ? titleOf(board) : `${titleOf(board)}, ${from}`;
}

/** How far along it is: "12 ranked · 6 in pool", "21 ranked · nothing in pool", or the pool and nothing ranked. */
export function metaOf(board: Board): string {
  const ranked = rankedCount(board);
  const inPool = poolCount(board);
  if (ranked === 0)
    return `${plural(strings.boards.inPool, inPool)} · ${strings.boards.nothingRanked}`;
  const pool = inPool === 0 ? strings.boards.nothingInPool : plural(strings.boards.inPool, inPool);
  return `${plural(strings.boards.ranked, ranked)} · ${pool}`;
}
