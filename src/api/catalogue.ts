import type { ApiClient } from "./client";
import { searchWikidata, type Fetcher, type WikidataCandidate } from "./wikidata";

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

/** A catalogue gets this long; after it the other one's answer goes out alone. The phone waits as long. */
export const SEARCH_TIMEOUT_MS = 5000;

const tmdbNumber = (item: CatalogueItem): number | null => {
  if (!item.id.startsWith("tmdb:")) return null;
  const id = Number(item.id.slice("tmdb:".length));
  return Number.isInteger(id) ? id : null;
};

const matchOf = (title: string, wanted: string): number => {
  if (wanted.length === 0) return 2;
  const lower = title.toLowerCase();
  if (lower === wanted) return 0;
  return lower.startsWith(wanted) ? 1 : 2;
};

/** One from each catalogue in turn, so a stable ranking has no reason to prefer whichever was asked first. */
function interleave<T>(...lists: readonly (readonly T[])[]): T[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const result: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) result.push(item);
    }
  }
  return result;
}

/**
 * Best match first, and a picture breaks ties. A picture is the second
 * question only: games, books and records have no free cover anywhere, so
 * keeping to the illustrated would drop them entirely.
 */
export function rankByMatch(query: string, items: readonly CatalogueItem[]): CatalogueItem[] {
  const wanted = query.trim().toLowerCase();
  const place = (item: CatalogueItem): number =>
    matchOf(item.title, wanted) * 2 + (item.imageUrl === null ? 1 : 0);
  return [...items].sort((a, b) => place(a) - place(b));
}

/**
 * The two catalogues as one list, the phone's way. Null is a catalogue that
 * did not answer. A film Wikidata knows by its TMDB number is left to TMDB,
 * which has the poster.
 */
export function mergeCatalogues(
  query: string,
  tmdb: readonly CatalogueItem[] | null,
  wikidata: readonly WikidataCandidate[] | null,
): CatalogueItem[] {
  const films = tmdb ?? [];
  const present = new Set(films.map(tmdbNumber));
  const others = (wikidata ?? [])
    .filter((found) => found.linkedTmdbId === null || !present.has(found.linkedTmdbId))
    .map((found) => found.item);
  return rankByMatch(query, interleave(films, others));
}

const within = <T>(ms: number, work: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The catalogue took too long")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });

/**
 * Films, series and people from TMDB and everything else from Wikidata, asked
 * at once. One of them failing leaves the other's answer; both failing fails.
 */
export async function searchEverywhere(
  client: ApiClient,
  query: string,
  language: string | null,
  fetcher?: Fetcher,
): Promise<CatalogueItem[]> {
  const [tmdb, wikidata] = await Promise.allSettled([
    within(SEARCH_TIMEOUT_MS, searchCatalogue(client, query)),
    within(SEARCH_TIMEOUT_MS, searchWikidata(query, language, fetcher)),
  ]);
  if (tmdb.status === "rejected" && wikidata.status === "rejected") throw tmdb.reason;
  return mergeCatalogues(
    query,
    tmdb.status === "fulfilled" ? tmdb.value : null,
    wikidata.status === "fulfilled" ? wikidata.value : null,
  );
}
