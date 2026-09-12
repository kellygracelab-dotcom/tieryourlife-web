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
