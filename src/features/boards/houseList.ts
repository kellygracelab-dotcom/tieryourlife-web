import type { PublishRequest } from "../../api/lists";
import type { PublishedList } from "../../api/types";
import { publishedPictureOf } from "../../lib/pictures";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { arrange } from "../tierboard/arrange";
import type { Board, NextUid } from "./model";
import { boardFromList, publishRequestOf } from "./publish";

/**
 * The boards this device edits for the house, by uid: the house list each
 * one updates, or null while it has not gone out yet. Kept beside the
 * boards and never on them, since the account refuses a board of a shape
 * it does not know. The boards themselves are the house repository's
 * (repository.ts): on this device only, never in the account's sync.
 */
export const HOUSE_BOARDS_KEY = "tyl:houseBoards";

/** A board edited for the house: the list it updates, or none before its first publish. */
export interface HouseLink {
  listId: string | null;
}

/**
 * The address says it too, so a reload stays the house's: `?house=new` for
 * a list not out yet, `?house=<list id>` for the one it updates.
 */
export const HOUSE_PARAM = "house";
const NEW_HOUSE = "new";

/** New house list: the one way a list is made, asked to make it for the house. */
export const NEW_HOUSE_PATH = `/b/new?${HOUSE_PARAM}=${NEW_HOUSE}`;

/** What the address says, or null when it says nothing of the house. */
export function houseLinkOfParam(value: string | null): HouseLink | null {
  if (value === null || value === "") return null;
  return { listId: value === NEW_HOUSE ? null : value };
}

export const houseParamOf = (listId: string | null): string => listId ?? NEW_HOUSE;

/** The board's page, opened for the house. */
export const houseBoardPath = (uid: string, listId: string | null): string =>
  `/b/${encodeURIComponent(uid)}?${new URLSearchParams({ [HOUSE_PARAM]: houseParamOf(listId) }).toString()}`;

function linksIn(store: KeyValueStore): Record<string, string | null> {
  const raw = store.read(HOUSE_BOARDS_KEY);
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const links: Record<string, string | null> = {};
  for (const [uid, listId] of Object.entries(parsed)) {
    if (listId === null || typeof listId === "string") links[uid] = listId;
  }
  return links;
}

/** The house list a board updates, as this device remembers it; null for a board of one's own. */
export function houseLinkOf(
  uid: string,
  store: KeyValueStore = localStorageStore,
): HouseLink | null {
  const links = linksIn(store);
  return uid in links ? { listId: links[uid] ?? null } : null;
}

/** The boards this device edits for a house list, by uid. */
export function houseBoardsOf(listId: string, store: KeyValueStore = localStorageStore): string[] {
  return Object.entries(linksIn(store))
    .filter(([, linked]) => linked === listId)
    .map(([uid]) => uid);
}

/** Remembers a board as the house's, tied to the list it updates or to none yet. */
export function linkToHouse(
  uid: string,
  listId: string | null,
  store: KeyValueStore = localStorageStore,
): void {
  store.write(HOUSE_BOARDS_KEY, JSON.stringify({ ...linksIn(store), [uid]: listId }));
}

/** Forgets a board edited for the house, once it is gone. */
export function unlinkFromHouse(uid: string, store: KeyValueStore = localStorageStore): void {
  const { [uid]: _gone, ...rest } = linksIn(store);
  store.write(HOUSE_BOARDS_KEY, JSON.stringify(rest));
  const { [uid]: _sent, ...others } = sentIn(store);
  store.write(HOUSE_SENT_KEY, JSON.stringify(others));
  const { [uid]: _seen, ...seenRest } = numbersIn(store, HOUSE_SEEN_KEY);
  store.write(HOUSE_SEEN_KEY, JSON.stringify(seenRest));
}

/**
 * Each house board's own edit time when it last matched its list: made from
 * it, or sent over it. Both are this device's clock, so a later edit is one
 * not sent yet whatever the server's clock says.
 */
export const HOUSE_SENT_KEY = "tyl:houseSent";

const sentIn = (store: KeyValueStore): Record<string, number> => numbersIn(store, HOUSE_SENT_KEY);

function numbersIn(store: KeyValueStore, key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(store.read(key) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
}

/** The board matches its list as it stands at this edit time: made from it, or sent over it. */
export function markHouseSent(
  uid: string,
  editedAt: number,
  store: KeyValueStore = localStorageStore,
): void {
  store.write(HOUSE_SENT_KEY, JSON.stringify({ ...sentIn(store), [uid]: editedAt }));
}

/**
 * Each house board's list as it stood when the board last matched it, by the
 * list's own updatedAt: the server's clock, which the list's row in the house
 * pane is read by too. Comparing it with this device's clock lost another
 * admin's change when that clock ran ahead.
 */
export const HOUSE_SEEN_KEY = "tyl:houseSeen";

/** The board matches its list as the server last stamped it; null when that is not known. */
export function markHouseSeen(
  uid: string,
  updatedAt: number | null,
  store: KeyValueStore = localStorageStore,
): void {
  const { [uid]: _before, ...rest } = numbersIn(store, HOUSE_SEEN_KEY);
  store.write(
    HOUSE_SEEN_KEY,
    JSON.stringify(updatedAt === null ? rest : { ...rest, [uid]: updatedAt }),
  );
}

/**
 * Whether the list changed after the board last matched it: by the server's
 * stamps when this device has one, else, for a board from before they were
 * kept or one whose list could not be read back once sent, by when the
 * board was last edited here.
 */
export function listChangedSince(
  board: Board,
  listUpdatedAt: number,
  store: KeyValueStore = localStorageStore,
): boolean {
  const seen = numbersIn(store, HOUSE_SEEN_KEY)[board.uid];
  return listUpdatedAt > (seen ?? board.editedAt);
}

/** Whether the board holds edits its list has not had; one never marked is taken to. */
export function hasUnsentEdits(board: Board, store: KeyValueStore = localStorageStore): boolean {
  const sent = sentIn(store)[board.uid];
  return sent === undefined || board.editedAt > sent;
}

/**
 * The board's own publish request, as the house sends it. A card whose
 * picture is one the backend already copied for this list goes by that
 * copy's id: a replace keeps only the copies it names by id, and a card
 * naming its copy by address would lose it the moment the list is replaced.
 */
export function houseRequestOf(board: Board, listId: string | null): PublishRequest | null {
  const request = publishRequestOf(board);
  if (request === null || listId === null) return request;
  return {
    ...request,
    items: request.items.map((item) => {
      const copy =
        item.pictureId === null && item.imageUrl !== null
          ? publishedPictureOf(item.imageUrl, listId)
          : null;
      return copy === null ? item : { ...item, imageUrl: null, pictureId: copy };
    }),
  };
}

/**
 * A house list as a board to edit it on: its cards in the tiers they stand
 * in, its section and its topic. Nobody's name goes on it: the house has none.
 */
export function boardFromHouseList(list: PublishedList, now: number, nextUid: NextUid): Board {
  const theirs = arrange(list);
  const board = boardFromList(list, theirs.known ? theirs.rows : null, now, nextUid);
  return {
    ...board,
    authorName: null,
    topic:
      list.topicId === null || list.topicId === undefined
        ? null
        : { id: list.topicId, name: list.topicName ?? "" },
  };
}
