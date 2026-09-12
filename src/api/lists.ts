import type { ApiClient } from "./client";
import type { FeedPage, FeedQuery, PublishedList } from "./types";

export function getList(client: ApiClient, id: string): Promise<PublishedList> {
  return client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`);
}

export function getFeed(client: ApiClient, query: FeedQuery = {}): Promise<FeedPage> {
  return client.request<FeedPage>("GET", "/lists", { query });
}

export function recordTake(client: ApiClient, id: string): Promise<{ counted: boolean }> {
  return client.request<{ counted: boolean }>("POST", `/lists/${encodeURIComponent(id)}/taken`);
}
