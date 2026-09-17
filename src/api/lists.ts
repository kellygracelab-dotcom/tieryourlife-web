import type { ApiClient } from "./client";
import type { FeedPage, FeedQuery, ListSummary, PublishedList } from "./types";

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

export function recordTake(client: ApiClient, id: string): Promise<{ counted: boolean }> {
  return client.request<{ counted: boolean }>("POST", `/lists/${encodeURIComponent(id)}/taken`);
}
