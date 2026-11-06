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

/**
 * One of the person's own pictures the backend copied for this list, to bring
 * back into their folder. Not a picture a copy took from another list: that one
 * goes out again by its address, so it stays tied to that list and goes with it
 * when a moderator takes that list down.
 */
const ownCopyIn = (list: PublishedList, url: string): boolean => {
  const name = publishedPictureOf(url, list.id);
  return name !== null && !(list.picturesFrom ?? []).some((from) => name.startsWith(`${from}-`));
};

/**
 * The history entry's state for one's own list seen as the community sees
 * it, the board's "See it in Community": that page stays the list's page,
 * and does not give way to the board as one's own list otherwise does.
 */
export const AS_COMMUNITY = { asCommunity: true } as const;

/** Whether the list's page was opened from its board, to be seen as the community sees it. */
export const seenAsCommunity = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as { asCommunity?: unknown }).asCommunity === true;

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
        item.pictureId === null && item.imageUrl !== null && ownCopyIn(list, item.imageUrl)
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
  // A picture of the list as the board shows it: the feed's copy of one's own
  // photo as that photo brought back, which the next Update names by id; one
  // from elsewhere as it is; a copy not brought back for any card is lost.
  const ownPicture = (url: string): string | null =>
    ownCopyIn(list, url) ? (copies.get(url)?.previewUrl ?? null) : url;
  const shown = (urls: readonly string[]) =>
    urls.flatMap((url) => {
      const picture = ownPicture(url);
      return picture === null ? [] : [picture];
    });
  // The collage the author chose, in their order; the first cards' art the
  // backend draws for none is no choice, and changes with the cards.
  const cardArt = list.items
    .flatMap((item) => (item.imageUrl === null ? [] : [item.imageUrl]))
    .slice(0, list.previewImages.length);
  const chose =
    list.previewImages.length !== cardArt.length ||
    list.previewImages.some((url, at) => url !== cardArt[at]);
  const cover = [
    ...new Set(
      list.coverImageUrl !== null
        ? shown([list.coverImageUrl])
        : chose
          ? shown(list.previewImages)
          : [],
    ),
  ];
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
    // The cover or collage the author chose stays, so an Update leaves it as it is.
    coverImageUrls: cover,
    coverImageUrl: cover.length === 1 ? (cover[0] ?? null) : null,
    // In step with the list, unless it carries changes the old editor had not sent.
    publishedEditedAt: kept === null ? board.editedAt : board.editedAt - 1,
  };
}
