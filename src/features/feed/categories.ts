import type { Category } from "../../api/types";

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
