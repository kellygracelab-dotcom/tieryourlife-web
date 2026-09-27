import type { CatalogueItem } from "./catalogue";

/** What the search needs of fetch; a test hands in its own. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const SEARCH_URL = "https://www.wikidata.org/w/api.php";
const SPARQL_URL = "https://query.wikidata.org/sparql";
const SEARCH_LIMIT = 20;
/** As many as the phone asks the details of. */
const MAX_DETAIL_IDS = 50;
const THUMBNAIL_WIDTH = 500;
const FALLBACK_LANGUAGE = "en";
const QID = /^Q\d+$/;

const IMAGE = "P18";
/**
 * A logo, for the subjects that have one instead of a photograph. A footballer
 * has a portrait somebody took and gave away; their club has a badge, and that
 * is the only picture of a club there is.
 */
const LOGO = "P154";
const TMDB_MOVIE_ID = "P4947";

/** A card Wikidata offers, and the film it is on TMDB when it says so: TMDB shows that one better. */
export interface WikidataCandidate {
  item: CatalogueItem;
  linkedTmdbId: number | null;
}

interface Details {
  imageUrl: string | null;
  linkedTmdbId: number | null;
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Wikidata speaks tags of two parts at most: "pt-br" stays, "zh-hant-tw" is "zh". */
export function wikidataLanguage(tag: string | null | undefined): string {
  const parts = (tag ?? "")
    .trim()
    .toLowerCase()
    .split("-")
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined || first === "und") return FALLBACK_LANGUAGE;
  return parts.length > 2 ? first : parts.join("-");
}

/** One question for the pictures and the TMDB numbers of everything the search found. */
export function detailsQuery(ids: readonly string[]): string {
  const values = ids
    .filter((id) => QID.test(id))
    .map((id) => `wd:${id}`)
    .join(" ");
  return (
    `SELECT ?item ?image ?logo ?tmdb WHERE { VALUES ?item { ${values} } ` +
    `OPTIONAL { ?item wdt:${IMAGE} ?image } ` +
    `OPTIONAL { ?item wdt:${LOGO} ?logo } ` +
    `OPTIONAL { ?item wdt:${TMDB_MOVIE_ID} ?tmdb } }`
  );
}

/** Commons hands a file over at any width; the page is https, so the picture is too. */
export function commonsThumbnail(filePath: string, width = THUMBNAIL_WIDTH): string {
  const secure = filePath.startsWith("http://")
    ? `https://${filePath.slice("http://".length)}`
    : filePath;
  return `${secure}${secure.includes("?") ? "&" : "?"}width=${width}`;
}

/** What the details answer says of each subject; the first picture and number of each are kept. */
export function detailsByQid(body: unknown): Map<string, Details> {
  const bindings = (body as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  const found = new Map<string, Details>();
  for (const raw of Array.isArray(bindings) ? bindings : []) {
    const binding = (raw ?? {}) as Record<string, { value?: unknown } | undefined>;
    const uri = text(binding.item?.value);
    if (uri === null) continue;
    const qid = uri.slice(uri.lastIndexOf("/") + 1);
    const before = found.get(qid);
    // The photograph first and the logo only after it: a company may have
    // both, and a picture of the building is the better card.
    const picture = text(binding.image?.value) ?? text(binding.logo?.value);
    const tmdb = Number(text(binding.tmdb?.value) ?? Number.NaN);
    found.set(qid, {
      imageUrl: before?.imageUrl ?? (picture === null ? null : commonsThumbnail(picture)),
      linkedTmdbId: before?.linkedTmdbId ?? (Number.isInteger(tmdb) ? tmdb : null),
    });
  }
  return found;
}

interface Found {
  id: string;
  label: string | null;
  description: string | null;
}

const foundOf = (raw: unknown): Found | null => {
  const entity = (raw ?? {}) as { id?: unknown; label?: unknown; description?: unknown };
  const id = text(entity.id);
  if (id === null || !QID.test(id)) return null;
  return { id, label: text(entity.label), description: text(entity.description) };
};

async function answerOf(fetcher: Fetcher, url: string): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  return (await response.json()) as unknown;
}

/**
 * Everything Wikidata knows by that name, in the reader's language, with a
 * picture where Commons has one. The same two questions the phone asks: the
 * search, then one query for the details of what it found.
 */
export async function searchWikidata(
  query: string,
  language: string | null,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<WikidataCandidate[]> {
  const spoken = wikidataLanguage(language);
  const search = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: spoken,
    uselang: spoken,
    type: "item",
    format: "json",
    limit: String(SEARCH_LIMIT),
    // Asked from a page, the API answers only a request that names no origin of its own.
    origin: "*",
  });
  const answer = (await answerOf(fetcher, `${SEARCH_URL}?${search.toString()}`)) as {
    search?: unknown;
  } | null;
  const found = (Array.isArray(answer?.search) ? answer.search : [])
    .map(foundOf)
    .filter((entity): entity is Found => entity !== null);
  if (found.length === 0) return [];

  const ids = found.map((entity) => entity.id).slice(0, MAX_DETAIL_IDS);
  const details = new URLSearchParams({ format: "json", query: detailsQuery(ids) });
  const byQid = detailsByQid(await answerOf(fetcher, `${SPARQL_URL}?${details.toString()}`));

  return found.map((entity) => ({
    item: {
      id: `wikidata:${entity.id}`,
      title: entity.label ?? entity.id,
      subtitle: entity.description,
      imageUrl: byQid.get(entity.id)?.imageUrl ?? null,
    },
    linkedTmdbId: byQid.get(entity.id)?.linkedTmdbId ?? null,
  }));
}
