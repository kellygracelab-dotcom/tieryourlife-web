import { errorOf } from "../../api/errors";
import type { UnpublishBoard } from "./BoardSettings";
import { setPublished, type Board } from "./model";

/**
 * A board's public copy taken down before the board is deleted, to the trash
 * or for good, as the phone does: a deleted list must not stay in the feed.
 * True when nothing public is left; already gone is what was asked for. Any
 * other refusal answers false, and the board stays where it is.
 */
export async function takenDown(board: Board, unpublish: UnpublishBoard): Promise<boolean> {
  if (board.publishedId === null) return true;
  try {
    await unpublish(board.publishedId);
    return true;
  } catch (reason: unknown) {
    return errorOf(reason).kind === "notFound";
  }
}

/** The board once its copy is down: no longer published, and its own again. */
export const unpublished = (board: Board, now: number): Board =>
  board.publishedId === null ? board : setPublished(board, null, null, now);
