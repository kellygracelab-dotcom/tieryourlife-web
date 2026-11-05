import { errorOf } from "../../api/errors";
import type { UnpublishBoard } from "./BoardSettings";
import { setPublished, type Board } from "./model";
import type { BoardsRepository } from "./repository";

/**
 * A board's public copy taken down before the board is deleted, to the trash
 * or for good, as the phone does: a deleted list must not stay in the feed.
 * True when nothing public is left of this account's; already gone is what was
 * asked for. A copy another account published is that account's to take down,
 * and this one only lets its board go, as the phone skips a list published by
 * another account. Any other refusal answers false, and the board stays where
 * it is.
 */
export async function takenDown(board: Board, unpublish: UnpublishBoard): Promise<boolean> {
  if (board.publishedId === null) return true;
  try {
    await unpublish(board.publishedId);
    return true;
  } catch (reason: unknown) {
    const kind = errorOf(reason).kind;
    return kind === "notFound" || kind === "notYours";
  }
}

/**
 * The board once its copy is down: no longer published, and its own again.
 * Its last edit stays, so Undo or Restore puts it back where it was in Recent.
 */
export const unpublished = (board: Board, now: number): Board =>
  board.publishedId === null
    ? board
    : { ...setPublished(board, null, null, now), editedAt: board.editedAt };

/**
 * A list taken down away from its board, from its own page or from /me: the
 * board that published it is its own again, as the phone's take-down does,
 * and no longer offers Update for a list that is gone.
 */
export function forgetPublished(listId: string, repository: BoardsRepository, now: number): void {
  const out = repository.all().filter((board) => board.publishedId === listId);
  if (out.length > 0) repository.saveAll(out.map((board) => unpublished(board, now)));
}
