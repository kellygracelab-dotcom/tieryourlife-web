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
 * it does not know; the board itself stays an ordinary private board.
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

/** Remembers a board as the house's, tied to the list it updates or to none yet. */
export function linkToHouse(
  uid: string,
  listId: string | null,
  store: KeyValueStore = localStorageStore,
): void {
  store.write(HOUSE_BOARDS_KEY, JSON.stringify({ ...linksIn(store), [uid]: listId }));
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
