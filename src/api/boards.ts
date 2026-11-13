import type { ApiClient } from "./client";
import type { PictureAttribution } from "./pictureAttribution";

/**
 * The copy of the person's boards their account keeps (`/boards` in the
 * backend): not the published snapshot but the board itself, pool and trash
 * included, under the uid the device gave it.
 */

/** Limits shared with the board sync service. */
export const MAX_BOARD_ITEMS = 2000;
export const MAX_PLAY_ANSWERS = 14_000;

export interface KeptTier {
  uid: string;
  position: number;
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
  isPool: boolean;
}

export interface BoardOrigin {
  listId: string;
  version: number;
}
export type RankingChoice = "offered" | "private" | "ranking";

export interface KeptItem {
  sourceIndex?: number;
  uid: string;
  pictureId: string | null;
  tierUid: string;
  position: number;
  title: string;
  imageUrl: string | null;
  /** Left out when the picture names nobody; the backend keeps it out of the fingerprint. */
  credit?: string | null;
  /**
   * Left out on a card without one. The account keeps it so a card picked on
   * one device publishes with its page link from another; not in the fingerprint.
   */
  attribution?: PictureAttribution;
  source: string;
  deletedAt: number | null;
}

/** The index names enough for a device to decide whether it needs the board itself. */
export interface KeptBoardEntry {
  uid: string;
  revision: number;
  updatedAt: number;
  deviceName: string | null;
  deleted: boolean;
  fingerprint: string | null;
  title: string;
  itemCount: number;
}

/**
 * A game of Play in progress, as the board document carries it between the
 * app and the site (agreed with the app's SavedGame): the engine's spec and
 * answers by card index, and which tiers the cards came from.
 */
export interface SyncedPlay {
  kind: "swiss" | "hill" | "bracket";
  count: number;
  seed: number;
  refine: boolean;
  /** The cards' uids in game order: engine index i is ids[i]. */
  ids: string[];
  history: [number, number, number | null][];
  /** The Swiss round reached; 0 for the other games. */
  round: number;
  startedAt: number;
  /** The tiers the cards came from, the pool's uid among them; absent for the whole board. */
  scope?: string[];
  /** Present, and true, only with exactly one tier in scope: the game only orders that tier. */
  keepTier?: true;
}

export interface KeptBoard {
  uid: string;
  revision: number;
  updatedAt: number;
  deviceName: string | null;
  deleted: boolean;
  fingerprint: string | null;
  title: string;
  displayMode: string;
  category: string | null;
  coverImageUrl: string | null;
  coverImageUrls: string[];
  /** The cover as one of the person's own photos, by id; absent from an older account. */
  coverPictureId?: string | null;
  authorName: string | null;
  publishedId: string | null;
  deletedAt: number | null;
  /** Kept only when true: published with no name or face. */
  anonymous?: boolean;
  takenFrom?: string | null;
  origin?: BoardOrigin | null;
  rankingChoice?: RankingChoice | null;
  play?: SyncedPlay | null;
  tiers: KeptTier[];
  items: KeptItem[];
}

/** A write says what it was based on; the account refuses one that has moved on since, handing the stored board back. */
export interface KeepBoardRequest {
  /** The revision this write was made on; absent on a first write, as CONTRACT says. */
  basedOn?: number;
  deviceName: string | null;
  fingerprint: string;
  title: string;
  displayMode: string;
  category: string | null;
  coverImageUrl: string | null;
  coverImageUrls: string[];
  /** Always said: null when the cover is not an own photo, so the account drops an old one. */
  coverPictureId: string | null;
  authorName: string | null;
  publishedId: string | null;
  deletedAt: number | null;
  anonymous?: boolean;
  takenFrom?: string | null;
  origin?: BoardOrigin | null;
  rankingChoice?: RankingChoice | null;
  play?: SyncedPlay | null;
  tiers: KeptTier[];
  items: KeptItem[];
}

export interface KeptBoardIndex {
  boards: KeptBoardEntry[];
  next: string | null;
}

export function loadBoardIndex(
  client: ApiClient,
  after: string | null = null,
): Promise<KeptBoardIndex> {
  return client.request<KeptBoardIndex>("GET", "/boards", {
    query: after === null ? {} : { after },
  });
}

export function loadKeptBoard(client: ApiClient, uid: string): Promise<KeptBoard> {
  return client.request<KeptBoard>("GET", `/boards/${encodeURIComponent(uid)}`);
}

/**
 * The account's answer to a write: the revision it keeps the board at, and
 * the catalogue pictures it now shows from our shared copies (CONTRACT,
 * Catalogue pictures on a board), each catalogue address to its copy's.
 */
export interface KeptAnswer {
  uid: string;
  revision: number;
  /** Absent when the account named none. */
  copies?: ReadonlyMap<string, string>;
}

const isHttps = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * `copies` as the account sent it, read with care: an object of https
 * addresses to https addresses, anything else in it left out; null when
 * nothing is left. A Map, so no address can be mistaken for an object's own key.
 */
export function copiesOf(raw: unknown): ReadonlyMap<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const copies = new Map<string, string>();
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    if (isHttps(from) && isHttps(to) && from !== to) copies.set(from, to);
  }
  return copies.size === 0 ? null : copies;
}

export async function keepBoard(
  client: ApiClient,
  uid: string,
  request: KeepBoardRequest,
): Promise<KeptAnswer> {
  const answer = await client.request<{ uid: string; revision: number; copies?: unknown }>(
    "PUT",
    `/boards/${encodeURIComponent(uid)}`,
    { body: request },
  );
  const copies = copiesOf(answer.copies);
  return {
    uid: answer.uid,
    revision: answer.revision,
    ...(copies === null ? {} : { copies }),
  };
}

/** Leaves a marker rather than nothing, so the other device lets go of the board too. */
export function forgetBoard(client: ApiClient, uid: string): Promise<void> {
  return client.request<void>("DELETE", `/boards/${encodeURIComponent(uid)}`);
}
