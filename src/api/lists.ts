import type { ApiClient } from "./client";
import type {
  FeedPage,
  FeedQuery,
  ListSummary,
  PublishedItem,
  PublishedList,
  PublishedTier,
} from "./types";

export async function loadList(client: ApiClient, id: string): Promise<PublishedList> {
  return publishedListOf(
    await client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`),
  );
}

/** One list as the site draws it, however it arrived: asked for, or already in the page. */
export const publishedListOf = (list: PublishedList): PublishedList => ({
  ...summaryOf(list),
  authorName: textOf(list.authorName),
  tiers: tiersOf(list.tiers),
  items: itemsOf(list.items),
});

/**
 * A slot of words that came as something else, null say: drawn empty. One
 * field the backend got wrong must not take the whole page down with it.
 */
const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** A tier that came as nothing at all: an unnamed one in a neutral grey, so the cards under it keep their places. */
const NO_TIER: PublishedTier = {
  label: "",
  caption: null,
  colorLight: "#8E8E93",
  colorDark: "#AEAEB2",
};

/** The tiers as the site can draw them, whatever came. */
export const tiersOf = (tiers: unknown): PublishedTier[] =>
  Array.isArray(tiers)
    ? tiers.map((tier: unknown) =>
        tier !== null && typeof tier === "object" ? (tier as PublishedTier) : NO_TIER,
      )
    : [];

/**
 * The cards as the site can draw them: words where words belong, and only
 * real pictures. A card that came as nothing stays as an empty one, since a
 * ranking names the cards by their places.
 */
export const itemsOf = (items: unknown): PublishedItem[] =>
  Array.isArray(items)
    ? items.map((item: unknown) => {
        if (item === null || typeof item !== "object") return { title: "", imageUrl: null };
        const card = item as PublishedItem;
        const imageUrl =
          card.imageUrl === null || card.imageUrl === undefined ? null : pictureOf(card.imageUrl);
        return { ...card, title: textOf(card.title), imageUrl };
      })
    : [];

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
  /** The uid of the board it was published from, on lists published since the server kept it. */
  boardUid?: string | null;
  /** Kept, but held for a moderator: out of the feed, and its link answers nobody yet. */
  underReview?: boolean;
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
  /** True takes the list out of its topic; a null topicId alone keeps the old one. */
  noTopic?: boolean;
  /**
   * A topic of the person's own to propose, two to forty characters: it
   * waits for a moderator, the list under Other until then. Never beside
   * topicId or noTopic, which the backend refuses.
   */
  newTopic?: string;
  /**
   * The board the list comes from, sent with every publish and replace: the
   * same board publishing again gets the list it already made, not a second
   * one, and the account's lists name their boards for a lost answer.
   */
  boardUid?: string;
  /** No name or face on the list anywhere public; the owner still has it. */
  anonymous?: boolean;
  /**
   * The published list the cards were saved from, as the app sends it: the
   * backend credits it, or keeps the publish as a ranking of it.
   */
  takenFrom?: string;
  tiers: PublishedTier[];
  items: {
    title: string;
    imageUrl: string | null;
    pictureId: string | null;
    /** Left out when the picture names nobody. */
    credit?: string;
    tierIndex: number | null;
  }[];
}

/**
 * Where a publish landed. `ranking` is true when the backend kept it as the
 * caller's ranking of the list it was taken from, whose id `id` is then.
 */
export interface Published {
  id: string;
  ranking?: boolean;
  /** The topic the list went under, a proposed one included; absent or null for none. */
  topicId?: string | null;
  /**
   * True when the board was out already: `id` is the list an earlier publish
   * made, and nothing of this request was written. The board takes the id
   * and is sent again over it, or the list keeps what the earlier one sent.
   */
  existing?: boolean;
  /**
   * True when the list was kept but starts out of the feed, held until staff
   * look: its link answers 404 to everybody, the author too.
   */
  underReview?: boolean;
}

export function publish(client: ApiClient, request: PublishRequest): Promise<Published> {
  return client.request<Published>("POST", "/lists", { body: request });
}

/** Replaces a published list in place: same id, same link, a fresh snapshot. */
export function republish(
  client: ApiClient,
  id: string,
  request: PublishRequest,
): Promise<Published> {
  return client.request<Published>("POST", `/lists/${encodeURIComponent(id)}`, {
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
