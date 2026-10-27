import type { ApiClient } from "./client";
import type {
  Category,
  FeedPage,
  FeedQuery,
  ListSummary,
  PublishedList,
  PublishedTier,
} from "./types";

export function loadList(client: ApiClient, id: string): Promise<PublishedList> {
  return client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`);
}

/**
 * A list as the site draws it. The backend can send an empty slot among a
 * list's pictures; drawn as it came, it was an <img src="null">, a broken
 * picture on the front page.
 */
export const summaryOf = (list: ListSummary): ListSummary => {
  const previews = (list.previewImages ?? []).filter(
    (url): url is string => typeof url === "string" && url.trim() !== "",
  );
  const cover =
    typeof list.coverImageUrl === "string" && list.coverImageUrl.trim() !== ""
      ? list.coverImageUrl
      : null;
  return previews.length === list.previewImages?.length && cover === list.coverImageUrl
    ? list
    : { ...list, previewImages: previews, coverImageUrl: cover };
};

export async function loadFeed(client: ApiClient, query: FeedQuery = {}): Promise<FeedPage> {
  const page = await client.request<FeedPage>("GET", "/lists", { query });
  return { ...page, lists: (page.lists ?? []).map(summaryOf) };
}

/** The lists this account published from the app, newest first; the backend orders them. */
export async function loadMyLists(client: ApiClient): Promise<{ lists: ListSummary[] }> {
  const mine = await client.request<{ lists: ListSummary[] }>("GET", "/lists/mine");
  return { ...mine, lists: (mine.lists ?? []).map(summaryOf) };
}

/** What the backend takes to publish a list; the site sends no pictures of its own yet. */
export interface PublishRequest {
  title: string;
  category: Category;
  coverImageUrl: string | null;
  coverPictureId: string | null;
  /** The pictures chosen for the cover collage, in their order; left out or empty when the cards' art decides. */
  coverImageUrls?: string[];
  tiers: PublishedTier[];
  items: {
    title: string;
    imageUrl: string | null;
    pictureId: string | null;
    tierIndex: number | null;
  }[];
}

export function publish(client: ApiClient, request: PublishRequest): Promise<{ id: string }> {
  return client.request<{ id: string }>("POST", "/lists", { body: request });
}

/** Replaces a published list in place: same id, same link, a fresh snapshot. */
export function republish(
  client: ApiClient,
  id: string,
  request: PublishRequest,
): Promise<{ id: string }> {
  return client.request<{ id: string }>("POST", `/lists/${encodeURIComponent(id)}`, {
    body: request,
  });
}

/** Takes the list out of the feed and off its address; the backend answers 204 either way. */
export function unpublish(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/${encodeURIComponent(id)}`);
}

export function recordTake(client: ApiClient, id: string): Promise<{ counted: boolean }> {
  return client.request<{ counted: boolean }>("POST", `/lists/${encodeURIComponent(id)}/taken`);
}
