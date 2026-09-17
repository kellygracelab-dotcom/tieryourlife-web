import type { Category, ListSummary } from "../../api/types";

export const CATEGORY_GLYPHS: Record<Category, string> = {
  anime: "movie_filter",
  film_tv: "theaters",
  games: "sports_esports",
  music: "headphones",
  books: "menu_book",
  food: "restaurant",
  sport: "sports_soccer",
  people: "person",
  other: "category",
};

export const categoryPath = (category: Category): string => `/c/${category}`;

export type CategoryCovers = Partial<Record<Category, string>>;

/** The first picture of the first list in each category: what the tile wears. */
export function coversOf(lists: readonly ListSummary[]): CategoryCovers {
  const covers: CategoryCovers = {};
  for (const list of lists) {
    const picture = list.coverImageUrl ?? list.previewImages[0];
    if (picture !== undefined && picture !== null && covers[list.category] === undefined) {
      covers[list.category] = picture;
    }
  }
  return covers;
}
