import type { ApiClient } from "./client";
import type {
  Category,
  FeedPage,
  FeedQuery,
  ListSummary,
  PublishedList,
  PublishedTier,
} from "./types";

export function getList(client: ApiClient, id: string): Promise<PublishedList> {
  return client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`);
}

export function getFeed(client: ApiClient, query: FeedQuery = {}): Promise<FeedPage> {
  return client.request<FeedPage>("GET", "/lists", { query });
}

/** The lists this account published from the app, newest first; the backend orders them. */
export function getMyLists(client: ApiClient): Promise<{ lists: ListSummary[] }> {
  return client.request<{ lists: ListSummary[] }>("GET", "/lists/mine");
}

/** What the backend takes to publish a list; the site sends no pictures of its own yet. */
export interface PublishRequest {
  title: string;
  category: Category;
  coverImageUrl: string | null;
  coverPictureId: string | null;
  tiers: PublishedTier[];
  items: {
    title: string;
    imageUrl: string | null;
    pictureId: string | null;
    tierIndex: number | null;
  }[];
}

export function publishList(client: ApiClient, request: PublishRequest): Promise<{ id: string }> {
  return client.request<{ id: string }>("POST", "/lists", { body: request });
}

export function recordTake(client: ApiClient, id: string): Promise<{ counted: boolean }> {
  return client.request<{ counted: boolean }>("POST", `/lists/${encodeURIComponent(id)}/taken`);
}
