import type { ApiClient } from "./client";

/** One thing the catalogue knows: enough to make a card from. */
export interface CatalogueItem {
  id: string;
  title: string;
  /** The year, or for a person what they are known for: names alone are a guess. */
  subtitle: string | null;
  imageUrl: string | null;
}

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

interface TmdbResult {
  id?: unknown;
  media_type?: unknown;
  title?: unknown;
  name?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  profile_path?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  known_for_department?: unknown;
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const year = (value: unknown): string | null => {
  const digits = text(value)?.slice(0, 4) ?? "";
  return /^\d{4}$/.test(digits) ? digits : null;
};

/**
 * The combined search answers with films, series and people together, and
 * with kinds this site has no card for; the same choices the phone makes.
 */
export function cardOf(result: unknown): CatalogueItem | null {
  const raw = (result ?? {}) as TmdbResult;
  const kind = raw.media_type;
  const title =
    kind === "movie" ? text(raw.title) : kind === "tv" || kind === "person" ? text(raw.name) : null;
  if (title === null || typeof raw.id !== "number") return null;
  // A person's picture is of them; anything else without a poster gets a still.
  const path =
    kind === "person" ? text(raw.profile_path) : (text(raw.poster_path) ?? text(raw.backdrop_path));
  const subtitle =
    kind === "person"
      ? text(raw.known_for_department)
      : year(kind === "tv" ? raw.first_air_date : raw.release_date);
  return {
    id: `tmdb:${raw.id}`,
    title,
    subtitle,
    imageUrl: path === null ? null : `${IMAGE_BASE}${path}`,
  };
}

export async function searchCatalogue(client: ApiClient, query: string): Promise<CatalogueItem[]> {
  const page = await client.request<{ results?: unknown }>("GET", "/3/search/multi", {
    query: { query, include_adult: false, language: "en-US", page: 1 },
    auth: "appCheckOnly",
  });
  const results = Array.isArray(page.results) ? page.results : [];
  return results.map(cardOf).filter((card): card is CatalogueItem => card !== null);
}
