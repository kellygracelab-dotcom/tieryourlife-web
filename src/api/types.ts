export const CATEGORIES = [
  "anime",
  "film_tv",
  "games",
  "music",
  "books",
  "food",
  "sport",
  "people",
  "other",
] as const;

/**
 * The nine sections the site draws from its own art and words. A list, a
 * board or the feed names its section by any id a moderator approved since
 * (docs/sections-api.md, 1), so those carry a string: this is only for the
 * nine's own looks and names.
 */
export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

/** The backend's shape of a section id, the nine's underscore included: what a link's `category` is read by. */
export const isSectionId = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{1,39}$/.test(value);

/** Whether the person signed in published the list, named or not. */
export const isOwnList = (
  list: Pick<ListSummary, "mine" | "authorUid">,
  uid: string | null,
): boolean => list.mine === true || (uid !== null && list.authorUid === uid);

export type FeedSort = "recent" | "popular";

/** The list another one was made from, credited the way the backend keeps it. */
export interface BasedOn {
  id: string;
  title: string;
  /** Null, or empty, when the original stands without an author. */
  authorName: string | null;
  /**
   * The original's author, for a link to their page and to know an editorial
   * original by. The backend does not send it yet; without it the name is
   * only words.
   */
  authorUid?: string | null;
}

export interface ListSummary {
  id: string;
  title: string;
  /** The list stands without an author; the backend will say so itself one day. */
  anonymous?: boolean;
  authorUid: string;
  authorName: string;
  authorPhotoUrl: string | null;
  /** Sent only to the one who published it: an anonymous list names nobody to compare with. */
  mine?: boolean;
  /** The section's id: one of the nine, or any approved since. */
  category: string;
  itemCount: number;
  coverImageUrl: string | null;
  previewImages: string[];
  tierColors: string[];
  updatedAt: number;
  takeCount: number;
  /** The topic the list was published under, when it has one. */
  topicId?: string | null;
  topicName?: string | null;
  /** Absent on lists made from nobody's, and on snapshots older than the credit. */
  basedOn?: BasedOn | null;
}

export interface PublishedTier {
  label: string;
  caption: string | null;
  colorLight: string;
  colorDark: string;
}

export interface PublishedItem {
  title: string;
  imageUrl: string | null;
  // Absent on snapshots published before the author's arrangement travelled.
  tierIndex?: number | null;
}

export interface PublishedList extends ListSummary {
  tiers: PublishedTier[];
  items: PublishedItem[];
}

// A type rather than an interface so it can travel as a query object.
export type FeedQuery = {
  /** A section's id: the feed narrows to any. */
  category?: string;
  /** One topic inside the category. */
  topic?: string;
  author?: string;
  q?: string;
  after?: string;
  sort?: FeedSort;
  following?: boolean;
};

export interface FeedPage {
  lists: ListSummary[];
  nextCursor: string | null;
  followingNobody?: boolean;
}

/** One thing the catalogue knows: enough to make a card from. */
export interface CatalogueItem {
  id: string;
  title: string;
  /** The year, or for a person what they are known for: names alone are a guess. */
  subtitle: string | null;
  imageUrl: string | null;
}
