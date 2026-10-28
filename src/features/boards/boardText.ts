import { plural, strings } from "../../strings";
import { poolCount, rankedCount, type Board } from "./model";

/** The board's name, or what an unnamed one is called. */
export const titleOf = (board: Board): string =>
  board.title.trim().length > 0 ? board.title : strings.boards.untitled;

/** How far along it is: "12 ranked · 6 in pool", "21 ranked · nothing in pool", or the pool and nothing ranked. */
export function metaOf(board: Board): string {
  const ranked = rankedCount(board);
  const inPool = poolCount(board);
  if (ranked === 0)
    return `${plural(strings.boards.inPool, inPool)} · ${strings.boards.nothingRanked}`;
  const pool = inPool === 0 ? strings.boards.nothingInPool : plural(strings.boards.inPool, inPool);
  return `${plural(strings.boards.ranked, ranked)} · ${pool}`;
}
