import type { PublishRequest } from "../../api/lists";
import {
  editorCreditOf,
  manualCreditOf,
  type PictureAttribution,
} from "../../api/pictureAttribution";
import type { PublishedList } from "../../api/types";
import { publishedPictureOf } from "../../lib/pictures";
import { type KeyValueStore, localStorageStore } from "../../lib/storage";
import { arrange } from "../tierboard/arrange";
import { coverCreditOf, type Board, type NextUid } from "./model";
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
  const { [uid]: _base, ...baseRest } = numbersIn(store, HOUSE_REVISION_KEY);
  store.write(HOUSE_REVISION_KEY, JSON.stringify(baseRest));
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

/**
 * Each house board's list revision (CONTRACT, List revision) as it stood
 * when the board last matched it: read with the list, or answered by the
 * board's own Update. Beside the board and never on it, like the rest, so
 * it never reaches the account. Unlike updatedAt it moves on with every
 * write, a fix made on the server too, so a board kept here is opened only
 * at the revision the list still has, and Update sends it as `baseRevision`.
 */
export const HOUSE_REVISION_KEY = "tyl:houseRevision";

/** Stored for a draft kept over a newer list without knowing the revision it was read at. */
const BEHIND = -1;

/**
 * The list revision a house board stands on: a number; "behind" for a draft
 * kept by choice over a list that moved on, whose own revision this device
 * never had (a board from before revisions were kept); null when not known.
 */
export type HouseBase = number | "behind" | null;

export function houseRevisionOf(uid: string, store: KeyValueStore = localStorageStore): HouseBase {
  const stored = numbersIn(store, HOUSE_REVISION_KEY)[uid];
  if (stored === BEHIND) return "behind";
  return stored !== undefined && Number.isSafeInteger(stored) && stored >= 0 ? stored : null;
}

/** The list revision a house board now stands on; null forgets it. */
export function markHouseRevision(
  uid: string,
  base: HouseBase,
  store: KeyValueStore = localStorageStore,
): void {
  const { [uid]: _before, ...rest } = numbersIn(store, HOUSE_REVISION_KEY);
  const value = base === "behind" ? BEHIND : base;
  store.write(
    HOUSE_REVISION_KEY,
    JSON.stringify(value === null ? rest : { ...rest, [uid]: value }),
  );
}

/**
 * Whether the board kept here may open as the list's copy: only at the
 * revision the list has now. A board with none (kept before revisions were)
 * may not: nothing tells whether the list moved on since, and the server's
 * own fixes never moved its updatedAt. A list read from a server that says
 * no revision is judged by the times, as before.
 */
export function boardMatchesList(
  board: Board,
  list: Pick<PublishedList, "revision" | "updatedAt">,
  store: KeyValueStore = localStorageStore,
): boolean {
  if (list.revision === undefined) return !listChangedSince(board, list.updatedAt, store);
  return houseRevisionOf(board.uid, store) === list.revision;
}

/**
 * A board just made from its list, or made to match it again: tied to it,
 * nothing of it unsent, and the list's time and revision remembered with it.
 */
export function markHouseCopy(
  board: Board,
  list: Pick<PublishedList, "id" | "revision" | "updatedAt">,
  store: KeyValueStore = localStorageStore,
): void {
  linkToHouse(board.uid, list.id, store);
  markHouseSent(board.uid, board.editedAt, store);
  markHouseSeen(board.uid, list.updatedAt, store);
  markHouseRevision(board.uid, list.revision ?? null, store);
}

/**
 * After the house's translations of a list were saved: that write moved the
 * list's revision on without saying to what, so the list is read again. A
 * board kept here for it takes the revision read only when it is the next
 * one after its own, the translations alone; any other means somebody else
 * wrote too, and the board keeps its own, for its Update to be refused and
 * the list loaded as it stands. Nothing is read when no board here knows its
 * revision.
 */
export async function afterHouseTranslations(
  listId: string,
  read: (id: string) => Promise<Pick<PublishedList, "revision" | "updatedAt">>,
  store: KeyValueStore = localStorageStore,
): Promise<void> {
  const known = houseBoardsOf(listId, store).flatMap((uid) => {
    const base = houseRevisionOf(uid, store);
    return typeof base === "number" ? [{ uid, base }] : [];
  });
  if (known.length === 0) return;
  let list: Pick<PublishedList, "revision" | "updatedAt">;
  try {
    list = await read(listId);
  } catch {
    return;
  }
  for (const { uid, base } of known) {
    if (list.revision !== base + 1) continue;
    markHouseRevision(uid, list.revision, store);
    markHouseSeen(uid, list.updatedAt, store);
  }
}

/**
 * The board with the editor's credits as the list now holds them, read back
 * after its own Update: a credit given by its page alone (a Commons file, a
 * Flickr photo, an iNaturalist observation) gets the author and the licence
 * the server read there, so the editor sees what readers will. A card is
 * matched by its title and its credit's page; the cover's credit by the
 * cover. Nothing else changes, its edit time neither, so nothing is taken
 * for an unsent edit; the same board when nothing was filled in.
 */
export function withServerCredits(board: Board, list: PublishedList): Board {
  let changed = false;
  const items = board.items.map((item) => {
    const mine = item.attribution;
    if (item.deletedAt !== null || mine?.manual !== true || mine.link === undefined) return item;
    const theirs = list.items.find(
      (one) =>
        one.title === item.title &&
        one.attribution?.manual === true &&
        one.attribution.link === mine.link,
    );
    const credit = editorCreditOf(theirs?.attribution);
    if (credit === null) return item;
    const { author: _a, license: _l, licenseUrl: _u, ...rest } = mine;
    const filled: PictureAttribution = { ...rest, ...credit, manual: true };
    if (
      filled.author === mine.author &&
      filled.license === mine.license &&
      filled.licenseUrl === mine.licenseUrl
    ) {
      return item;
    }
    changed = true;
    return { ...item, attribution: filled };
  });
  const cover = coverCreditOf(board);
  const theirCover = list.coverAttribution;
  const coverFilled =
    cover !== undefined &&
    cover !== null &&
    theirCover !== undefined &&
    board.coverCredit !== undefined &&
    theirCover.link === cover.link &&
    (theirCover.author !== cover.author ||
      theirCover.license !== cover.license ||
      theirCover.licenseUrl !== cover.licenseUrl);
  if (!changed && !coverFilled) return board;
  return {
    ...board,
    items,
    ...(coverFilled && board.coverCredit !== undefined
      ? { coverCredit: { url: board.coverCredit.url, credit: theirCover } }
      : {}),
  };
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
 * The editor's credits go with it: each card's on its attribution, the
 * cover's as coverAttribution while the cover is the one it was given for.
 */
export function houseRequestOf(board: Board, listId: string | null): PublishRequest | null {
  const own = publishRequestOf(board);
  if (own === null) return null;
  const coverCredit = coverCreditOf(board);
  const request: PublishRequest =
    coverCredit === undefined
      ? own
      : { ...own, coverAttribution: coverCredit === null ? null : manualCreditOf(coverCredit) };
  if (listId === null) return request;
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
 * in, its section, its topic, and its cover with the editor's credit for it.
 * Nobody's name goes on it: the house has none.
 */
export function boardFromHouseList(list: PublishedList, now: number, nextUid: NextUid): Board {
  const theirs = arrange(list);
  const board = boardFromList(list, theirs.known ? theirs.rows : null, now, nextUid);
  const cover = list.coverImageUrl;
  return {
    ...board,
    ...(cover === null
      ? {}
      : {
          coverImageUrl: cover,
          coverImageUrls: [cover],
          ...(list.coverAttribution === undefined
            ? {}
            : { coverCredit: { url: cover, credit: list.coverAttribution } }),
        }),
    authorName: null,
    topic:
      list.topicId === null || list.topicId === undefined
        ? null
        : { id: list.topicId, name: list.topicName ?? "" },
  };
}
