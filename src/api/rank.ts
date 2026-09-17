import type { ApiClient } from "./client";
import type { Category, PublishedItem, PublishedTier } from "./types";

export interface RankingSnapshot {
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: Category;
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

export function saveRanking(
  client: ApiClient,
  listId: string,
  rows: readonly (readonly number[])[],
): Promise<SavedRanking> {
  return client.request<SavedRanking>("POST", "/api/rank", {
    body: { listId, rows: rows.map((row) => [...row]) },
  });
}

/** Read as an account when there is one, so the answer can say whether it is yours. */
export function getRanking(client: ApiClient, code: string, asAccount = false): Promise<Ranking> {
  return client.request<Ranking>(
    "GET",
    `/api/rank/${encodeURIComponent(code)}`,
    asAccount ? {} : { auth: "appCheckOnly" },
  );
}

export function updateRanking(
  client: ApiClient,
  code: string,
  rows: readonly (readonly number[])[],
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PUT", `/api/rank/${encodeURIComponent(code)}`, {
    body: { rows: rows.map((row) => [...row]) },
  });
}

export function claimRanking(
  client: ApiClient,
  code: string,
  claimToken: string,
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PATCH", `/api/rank/${encodeURIComponent(code)}`, {
    body: { claimToken },
  });
}

export interface RankingSummary {
  code: string;
  listId: string;
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: Category;
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

export function getMyRankings(client: ApiClient): Promise<MyRankings> {
  return client.request<MyRankings>("GET", "/api/me/rankings");
}
