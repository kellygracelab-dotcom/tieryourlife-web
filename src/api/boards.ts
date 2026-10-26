import type { ApiClient } from "./client";

/**
 * The copy of the person's boards their account keeps (`/boards` in the
 * backend): not the published snapshot but the board itself, pool and trash
 * included, under the uid the device gave it.
 */

export interface KeptTier {
  uid: string;
  position: number;
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
  isPool: boolean;
}

export interface KeptItem {
  uid: string;
  pictureId: string | null;
  tierUid: string;
  position: number;
  title: string;
  imageUrl: string | null;
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
  authorName: string | null;
  publishedId: string | null;
  deletedAt: number | null;
  tiers: KeptTier[];
  items: KeptItem[];
}

/** A write says what it was based on; the account refuses one that has moved on since, handing the stored board back. */
export interface KeepBoardRequest {
  basedOn: number | null;
  deviceName: string | null;
  fingerprint: string;
  title: string;
  displayMode: string;
  category: string | null;
  coverImageUrl: string | null;
  coverImageUrls: string[];
  authorName: string | null;
  publishedId: string | null;
  deletedAt: number | null;
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

export function keepBoard(
  client: ApiClient,
  uid: string,
  request: KeepBoardRequest,
): Promise<{ uid: string; revision: number }> {
  return client.request<{ uid: string; revision: number }>(
    "PUT",
    `/boards/${encodeURIComponent(uid)}`,
    { body: request },
  );
}

/** Leaves a marker rather than nothing, so the other device lets go of the board too. */
export function forgetBoard(client: ApiClient, uid: string): Promise<void> {
  return client.request<void>("DELETE", `/boards/${encodeURIComponent(uid)}`);
}
