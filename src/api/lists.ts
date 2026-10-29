import type { ApiClient } from "./client";
import type { FeedPage, FeedQuery, ListSummary, PublishedList, PublishedTier } from "./types";

export async function loadList(client: ApiClient, id: string): Promise<PublishedList> {
  return publishedListOf(
    await client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`),
  );
}

/** One list as the site draws it, however it arrived: asked for, or already in the page. */
export const publishedListOf = (list: PublishedList): PublishedList => {
  const items = (list.items ?? []).map((item) =>
    item.imageUrl === null || pictureOf(item.imageUrl) !== null
      ? item
      : { ...item, imageUrl: null },
  );
  return { ...summaryOf(list), tiers: list.tiers ?? [], items };
};

/**
 * A picture's address, or null when the slot holds none. Only https:// counts,
 * as in the app: five editorial lists keep the word "null" as their cover, and
 * drawn as it came it was an <img src="null">, a broken picture in the feed and
 * a black section tile.
 */
export const pictureOf = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

/** A list as the site draws it: its cover and previews only real pictures. */
export const summaryOf = <T extends ListSummary>(list: T): T => {
  const previews = (list.previewImages ?? []).filter((url) => pictureOf(url) !== null);
  const cover = pictureOf(list.coverImageUrl);
  return previews.length === list.previewImages?.length && cover === list.coverImageUrl
    ? list
    : { ...list, previewImages: previews, coverImageUrl: cover };
};

export async function loadFeed(client: ApiClient, query: FeedQuery = {}): Promise<FeedPage> {
  const page = await client.request<FeedPage>("GET", "/lists", { query });
  return { ...page, lists: (page.lists ?? []).map(summaryOf) };
}

/**
 * One of this account's own published lists. Published into a section of
 * one's own still waiting for a moderator, it sits in the section the
 * proposal files under, and says which one it moves to.
 */
export interface MyList extends ListSummary {
  proposedSection?: string | null;
  proposedSectionName?: string | null;
}

/** The lists this account published from the app, newest first; the backend orders them. */
export async function loadMyLists(client: ApiClient): Promise<{ lists: MyList[] }> {
  const mine = await client.request<{ lists: MyList[] }>("GET", "/lists/mine");
  return { ...mine, lists: (mine.lists ?? []).map(summaryOf) };
}

/** What the backend takes to publish a list; the site sends no pictures of its own yet. */
export interface PublishRequest {
  title: string;
  /**
   * Any approved section, or one of the person's own still waiting: the list
   * waits in the section it files under and moves once it is approved.
   */
  category: string;
  coverImageUrl: string | null;
  coverPictureId: string | null;
  /** The pictures chosen for the cover collage, in their order; left out or empty when the cards' art decides. */
  coverImageUrls?: string[];
  /** An approved topic of the list's section, which files the list under it; null for none. */
  topicId?: string | null;
  /** No name or face on the list anywhere public; the owner still has it. */
  anonymous?: boolean;
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
