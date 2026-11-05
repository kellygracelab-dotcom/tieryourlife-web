import type { ApiClient } from "./client";
import type { PublishedItem, PublishedTier } from "./types";

export interface RankingSnapshot {
  title: string;
  /** The list stands without an author, and the ranking names nobody. */
  editorial?: boolean;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  tiers: PublishedTier[];
  items: PublishedItem[];
}

export interface Ranking {
  code: string;
  listId: string;
  listAvailable: boolean;
  snapshot: RankingSnapshot;
  rows: number[][];
  createdAt: number;
  /** Set when the caller's account keeps this ranking; pages made before it asked never carry it. */
  yours?: boolean;
}

export interface SavedRanking {
  code: string;
  claimToken: string;
}

/**
 * `version` is the list's updatedAt as the rows were placed on it: the
 * server refuses them (409 LIST_CHANGED) once the list was republished since.
 */
export function keepRanking(
  client: ApiClient,
  listId: string,
  rows: readonly (readonly number[])[],
  version?: number,
): Promise<SavedRanking> {
  return client.request<SavedRanking>("POST", "/api/rank", {
    body: {
      listId,
      rows: rows.map((row) => [...row]),
      ...(version === undefined ? {} : { version }),
    },
  });
}

/** Read as an account when there is one, so the answer can say whether it is yours. */
export function loadRanking(client: ApiClient, code: string, asAccount = false): Promise<Ranking> {
  return client.request<Ranking>(
    "GET",
    `/api/rank/${encodeURIComponent(code)}`,
    asAccount ? {} : { auth: "appCheckOnly" },
  );
}

export function rearrangeRanking(
  client: ApiClient,
  code: string,
  rows: readonly (readonly number[])[],
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PUT", `/api/rank/${encodeURIComponent(code)}`, {
    body: { rows: rows.map((row) => [...row]) },
  });
}

export function claimKept(
  client: ApiClient,
  code: string,
  claimToken: string,
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PATCH", `/api/rank/${encodeURIComponent(code)}`, {
    body: { claimToken },
  });
}

/** Takes a kept ranking away for good; only the account that keeps it may. */
export function removeRanking(client: ApiClient, code: string): Promise<void> {
  return client.request<void>("DELETE", `/api/rank/${encodeURIComponent(code)}`);
}

export interface RankingSummary {
  code: string;
  listId: string;
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  placed: number;
  itemCount: number;
  imageUrl: string | null;
  createdAt: number;
}

export interface MyRankings {
  rankings: RankingSummary[];
  // The server stops at a fixed number; true means there were rankings beyond it.
  more: boolean;
}

export function loadMyRankings(client: ApiClient): Promise<MyRankings> {
  return client.request<MyRankings>("GET", "/api/me/rankings");
}
