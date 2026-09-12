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

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

export type FeedSort = "recent" | "popular";

export interface ListSummary {
  id: string;
  title: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: Category;
  itemCount: number;
  coverImageUrl: string | null;
  previewImages: string[];
  tierColors: string[];
  updatedAt: number;
  takeCount: number;
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
  category?: Category;
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
