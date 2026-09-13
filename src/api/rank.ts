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

export function getRanking(client: ApiClient, code: string): Promise<Ranking> {
  return client.request<Ranking>("GET", `/api/rank/${encodeURIComponent(code)}`, {
    auth: "appCheckOnly",
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
