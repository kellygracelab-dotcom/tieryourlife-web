import type { PublishedList } from "../../api/types";
import { publishedPictureOf, type UploadedPicture } from "../../lib/pictures";
import type { KeyValueStore } from "../../lib/storage";
import { draftOf, loadEditorDraft, NEW_DRAFT_KEY, type Draft } from "../editor/model";
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
 * A list begun in the old editor, kept as a board and its draft let go; null
 * when nothing was begun there, a name or a card. Nothing writes that draft
 * any more: this keeps what an earlier visit left from waiting, unseen,
 * behind a bare New list.
 */
export function keepOldDraft(
  store: KeyValueStore,
  repository: BoardsRepository,
  now: number,
  nextUid: NextUid,
): Board | null {
  const kept = loadEditorDraft(store, NEW_DRAFT_KEY);
  if (kept === null || (kept.title.trim().length === 0 && kept.items.length === 0)) return null;
  const board = boardFromDraft(kept, now, nextUid);
  repository.save(board);
  store.remove(NEW_DRAFT_KEY);
  return board;
}

/** Where this device remembers the board it made of a kept ranking, so a second visit opens it again. */
export const rankingBoardKey = (code: string): string => `tyl:rankingBoard:${code}`;

/** The board made of this ranking on this device, while it is kept and out of the trash. */
export function boardOfRanking(
  store: KeyValueStore,
  repository: BoardsRepository,
  code: string,
): Board | null {
  const uid = store.read(rankingBoardKey(code));
  const board = uid === null ? null : repository.get(uid);
  return board !== null && board.deletedAt === null ? board : null;
}

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
  // A card's credit is its picture's, which the draft does not carry: found again on the list.
  const credits = new Map(
    list.items.map((item) => [
      `${item.title}
${item.imageUrl ?? ""}`,
      item.credit ?? null,
    ]),
  );
  const cover = list.coverImageUrl;
  return {
    ...board,
    items: board.items.map((item, index) => {
      const card = draft.items[index];
      const credit =
        card === undefined
          ? null
          : credits.get(`${card.title}
${card.imageUrl ?? ""}`);
      return credit === undefined || credit === null ? item : { ...item, credit };
    }),
    authorName: list.authorName,
    publishedId: list.id,
    // As named or as nameless as the list went out, in the topic it went to:
    // an Update with nothing changed must not put the author's name on it.
    anonymous: list.anonymous === true,
    topic:
      typeof list.topicId === "string" && list.topicId !== ""
        ? { id: list.topicId, name: list.topicName ?? "" }
        : null,
    // A cover from elsewhere stays; one of the feed's own copies would be gone after the republish.
    coverImageUrls: cover !== null && publishedPictureOf(cover, list.id) === null ? [cover] : [],
    // In step with the list, unless it carries changes the old editor had not sent.
    publishedEditedAt: kept === null ? board.editedAt : board.editedAt - 1,
  };
}
