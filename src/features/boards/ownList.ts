import type { PublishedList } from "../../api/types";
import { publishedPictureOf, type UploadedPicture } from "../../lib/pictures";
import { draftOf, type Draft } from "../editor/model";
import type { Board, NextUid } from "./model";
import type { BoardsRepository } from "./repository";
import { boardFromDraft } from "./publish";

export type CopyBack = (url: string) => Promise<UploadedPicture>;

/** Pictures brought back at once: enough to keep the line busy. */
const COPIES_AT_ONCE = 4;

/** The board a published list is changed on: the one that published it, while it is not in the trash. */
export const boardOfList = (repository: BoardsRepository, listId: string): Board | null =>
  repository.all().find((board) => board.publishedId === listId && board.deletedAt === null) ??
  null;

/**
 * One's own published list as the board it is changed on, as on the phone.
 * A list published before boards had none; its board is made here, from the
 * changes the old editor kept for it when there are some, from the list
 * otherwise. The backend keeps only the pictures a republish names by id, so
 * every picture of this list comes back into the person's own folder first,
 * under an id of its own: the board's republish then names them all by id,
 * as it does every own picture, and the copies the feed had can go.
 */
export async function boardForOwnList(
  list: PublishedList,
  kept: Draft | null,
  copyBack: CopyBack,
  now: number,
  nextUid: NextUid,
): Promise<Board> {
  const draft = kept ?? draftOf(list);
  const wanted = [
    ...new Set(
      draft.items.flatMap((item) =>
        item.pictureId === null &&
        item.imageUrl !== null &&
        publishedPictureOf(item.imageUrl, list.id) !== null
          ? [item.imageUrl]
          : [],
      ),
    ),
  ];
  const copies = new Map<string, UploadedPicture>();
  for (let start = 0; start < wanted.length; start += COPIES_AT_ONCE) {
    const batch = wanted.slice(start, start + COPIES_AT_ONCE);
    for (const [url, copy] of await Promise.all(
      batch.map(async (address) => [address, await copyBack(address)] as const),
    )) {
      copies.set(url, copy);
    }
  }
  const board = boardFromDraft(
    {
      ...draft,
      items: draft.items.map((item) => {
        const copy = item.imageUrl === null ? undefined : copies.get(item.imageUrl);
        return copy === undefined
          ? item
          : { ...item, imageUrl: copy.previewUrl, pictureId: copy.pictureId };
      }),
    },
    now,
    nextUid,
  );
  const cover = list.coverImageUrl;
  return {
    ...board,
    authorName: list.authorName,
    publishedId: list.id,
    // A cover from elsewhere stays; one of the feed's own copies would be gone after the republish.
    coverImageUrls: cover !== null && publishedPictureOf(cover, list.id) === null ? [cover] : [],
    // In step with the list, unless it carries changes the old editor had not sent.
    publishedEditedAt: kept === null ? board.editedAt : board.editedAt - 1,
  };
}
