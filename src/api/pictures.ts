import { busyOf } from "./errors";
import { attributionOf, type PictureAttribution } from "./pictureAttribution";
import { creditOf } from "./pictureCredit";
import { quotaOf, type LinkQuota } from "./linkQuota";
import type { ApiClient } from "./client";
import type { CatalogueItem } from "./types";

/**
 * Where a card's picture is looked for, the backend choosing the catalogues
 * (proxy #57–#61): TMDB for film, TV and people, AniList for anime, Steam
 * and IGDB for games, Open Library for books, iNaturalist for animals,
 * Wikidata everywhere and for music on its own (Deezer is out until the
 * right to show its covers is clear), and in All the web too when the
 * catalogues have little.
 */
export const PICTURE_SCOPES = [
  "all",
  "film_tv",
  "anime",
  "games",
  "music",
  "books",
  "people",
  "animals",
] as const;
export type PictureScope = (typeof PICTURE_SCOPES)[number];

const isScope = (value: string): value is PictureScope =>
  (PICTURE_SCOPES as readonly string[]).includes(value);

/** A board's section looks in its own catalogues; food, sport and the rest in all of them. */
export const scopeFor = (category: string | null | undefined): PictureScope =>
  category !== null && category !== undefined && isScope(category) ? category : "all";

export const PICTURE_SOURCES = [
  "tmdb",
  "anilist",
  "steam",
  "igdb",
  "openlibrary",
  "wikidata",
  "inaturalist",
  "web",
  /** A catalogue this site does not know yet: kept at its address all the same. */
  "other",
] as const;
export type PictureSource = (typeof PICTURE_SOURCES)[number];

/** What a picture is of. Wikidata's things and the web's pages say nothing worth a label. */
export const PICTURE_KINDS = [
  "movie",
  "tv",
  "person",
  "anime",
  "manga",
  "character",
  "game",
  "artist",
  "album",
  "book",
  "animal",
  "thing",
  "web",
] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

/** How sure the backend is that a hit is what the typed name means in this list (picture search, stage 1). */
export type PictureConfidence = "high" | "medium" | "low";
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];

/**
 * Why a hit is not `high`, so the person is told what to look at. A word this
 * site does not know yet is no reason it can name, and is left out.
 */
export type PictureDoubt =
  "namesakes" | "otherName" | "spelling" | "otherKind" | "noSection" | "web";
const DOUBTS: readonly string[] = [
  "namesakes",
  "otherName",
  "spelling",
  "otherKind",
  "noSection",
  "web",
];

/** How a search that found nothing as typed was tried again: a cut tail, the other keyboard, a spelling. */
export interface SearchedAs {
  text: string;
  how: string;
}

export interface FoundPicture extends CatalogueItem {
  imageUrl: string;
  /** A smaller copy for the grid; null when the picture is drawn from imageUrl itself. */
  thumbUrl: string | null;
  source: PictureSource;
  kind: PictureKind;
  /** Who the picture's license asks to be named beside it; null when it asks for nobody. */
  credit: string | null;
  /** Where the picture came from and whom it names; null from a backend that says nothing of it. */
  attribution: PictureAttribution | null;
  /** The name of it that matches what was typed, when that is not its title: "Kyiv" for "Киев". */
  matchedName?: string;
  /** On the first page of a backend from stage 1; absent from an older one and on later pages. */
  confidence?: PictureConfidence;
  /** Why it is not `high`, the words this site knows only. */
  doubts?: PictureDoubt[];
}

/** A quiet line over the results: the web is done for today, or for now. */
export type PictureNotice = "webDailyLimit" | "webOff";
const NOTICES: readonly string[] = ["webDailyLimit", "webOff"];

export interface PicturePage {
  items: FoundPicture[];
  /** More from the catalogues; the web answers on the first page only. */
  hasMore: boolean;
  notices: PictureNotice[];
  /** A quick answer only: the whole search, slow catalogues and the web, can still add hits. */
  rest: boolean;
  /**
   * The catalogues of this search that are busy (`anilist`, `tmdb`…): what
   * they would have found is missing. Only when there are any.
   */
  busy?: string[];
  /** When the busy catalogues may be asked again (epoch ms); only beside `busy`. */
  retryAt?: number;
  /** Nothing matched the words as typed; these hits are for what was searched instead. */
  searchedAs?: SearchedAs;
}

export interface PictureAsk {
  q: string;
  scope: PictureScope;
  /** 1-based. */
  page: number;
  /** "Search everywhere": the web is asked even when the catalogues found plenty. */
  web: boolean;
  /** Only the catalogues that answer in a second or two, never the web; `rest` says whether the whole search is worth asking. */
  quick?: boolean;
  /**
   * The list's section (its `category`), whatever the scope: the backend puts
   * the kind of picture the list holds first, and says how sure it is.
   */
  section?: string;
  /** The list's topic id, when it has one: cars, plants, clubs say more than Other does. */
  topic?: string;
}

/** The backend refuses fewer letters than this. */
export const MIN_PICTURE_QUERY = 2;
/** …and more than this. */
export const MAX_PICTURE_QUERY = 100;

const https = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("https://");

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** One answer as a picture, or nothing when it is not one this site can draw. */
export function pictureOf(raw: unknown): FoundPicture | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id === "") return null;
  if (typeof item.title !== "string" || item.title.trim() === "") return null;
  if (!https(item.imageUrl)) return null;
  return {
    id: item.id,
    title: item.title,
    subtitle: typeof item.subtitle === "string" && item.subtitle !== "" ? item.subtitle : null,
    imageUrl: item.imageUrl,
    thumbUrl: https(item.thumbUrl) ? item.thumbUrl : null,
    source: oneOf(PICTURE_SOURCES, item.source) ? item.source : "other",
    kind: oneOf(PICTURE_KINDS, item.kind) ? item.kind : "thing",
    credit: creditOf(item.credit),
    attribution: attributionOf(item.attribution),
    ...(typeof item.popularity === "number" &&
    Number.isFinite(item.popularity) &&
    item.popularity >= 0
      ? { popularity: item.popularity }
      : {}),
    ...(typeof item.matchedName === "string" && item.matchedName.trim() !== ""
      ? { matchedName: item.matchedName }
      : {}),
    ...(oneOf(CONFIDENCES as readonly PictureConfidence[], item.confidence)
      ? { confidence: item.confidence }
      : {}),
    ...(Array.isArray(item.doubts)
      ? {
          doubts: item.doubts.filter((one): one is PictureDoubt => DOUBTS.includes(one as string)),
        }
      : {}),
  };
}

/** What a second attempt searched instead, or null for anything that is not one. */
function searchedAsOf(value: unknown): SearchedAs | null {
  if (value === null || typeof value !== "object") return null;
  const { text, how } = value as Record<string, unknown>;
  return typeof text === "string" && text.trim() !== ""
    ? { text, how: typeof how === "string" ? how : "" }
    : null;
}

export async function searchPictures(
  client: ApiClient,
  ask: PictureAsk & { lang: string },
): Promise<PicturePage> {
  const answer = await client.request<{
    items?: unknown;
    hasMore?: unknown;
    notices?: unknown;
    rest?: unknown;
    busy?: unknown;
    retryAt?: unknown;
    searchedAs?: unknown;
  }>("GET", "/lists/pictures", {
    query: {
      q: ask.q.trim().slice(0, MAX_PICTURE_QUERY),
      scope: ask.scope,
      lang: ask.lang,
      page: ask.page,
      ...(ask.web ? { web: 1 } : {}),
      ...(ask.quick === true ? { part: "quick" } : {}),
      ...(ask.section === undefined || ask.section === "" ? {} : { section: ask.section }),
      ...(ask.topic === undefined || ask.topic === "" ? {} : { topic: ask.topic }),
    },
  });
  const searchedAs = searchedAsOf(answer.searchedAs);
  const items = Array.isArray(answer.items) ? answer.items : [];
  const notices = Array.isArray(answer.notices) ? answer.notices : [];
  const busy = busyOf(answer.busy);
  const retryAt =
    typeof answer.retryAt === "number" && Number.isFinite(answer.retryAt) && answer.retryAt > 0
      ? answer.retryAt
      : null;
  return {
    items: items.map(pictureOf).filter((one): one is FoundPicture => one !== null),
    hasMore: answer.hasMore === true,
    // Codes this page does not know yet are left unsaid.
    notices: notices.filter((one): one is PictureNotice => NOTICES.includes(one as string)),
    // A backend from before quick answers sends the whole one, and no rest.
    rest: answer.rest === true,
    // A backend from before busy catalogues says nothing of them: none was.
    ...(busy === null ? {} : { busy, ...(retryAt === null ? {} : { retryAt }) }),
    ...(searchedAs === null ? {} : { searchedAs }),
  };
}

/**
 * A picture found on the web, copied by the backend into the person's own
 * pictures, as an upload would be: the card then depends on no other site,
 * and the safety check sees it when the list goes out. The pictureId it gets.
 */
export async function keepPicture(client: ApiClient, url: string): Promise<string> {
  const answer = await client.request<{ pictureId?: unknown }>("POST", "/lists/pictures/keep", {
    body: { url },
  });
  if (typeof answer.pictureId !== "string" || answer.pictureId === "") {
    throw new Error("no picture id");
  }
  return answer.pictureId;
}

/** A picture asked for by its address (POST /lists/pictures/link). */
export interface LinkAsk {
  url: string;
  /** The page the picture was found on: https, at most 500 characters. */
  link?: string;
  credit?: string;
}

/**
 * What a picture from a link became. A plain picture is fetched, checked and
 * kept in the person's own folder: its `pictureId`, and no address. A
 * catalogue's own address is kept as it is: its `imageUrl` and the
 * catalogue's attribution, and no copy.
 */
export interface LinkAnswer {
  pictureId: string | null;
  imageUrl: string | null;
  attribution: PictureAttribution | null;
  credit: string | null;
  quota: LinkQuota | null;
}

export async function linkPicture(client: ApiClient, ask: LinkAsk): Promise<LinkAnswer> {
  const answer = await client.request<{
    pictureId?: unknown;
    imageUrl?: unknown;
    attribution?: unknown;
    credit?: unknown;
    quota?: unknown;
  }>("POST", "/lists/pictures/link", {
    body: {
      url: ask.url,
      ...(ask.link === undefined ? {} : { link: ask.link }),
      ...(ask.credit === undefined ? {} : { credit: ask.credit }),
    },
  });
  const pictureId =
    typeof answer.pictureId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(answer.pictureId)
      ? answer.pictureId
      : null;
  const imageUrl = pictureId === null && https(answer.imageUrl) ? answer.imageUrl : null;
  if (pictureId === null && imageUrl === null) throw new Error("no picture");
  return {
    pictureId,
    imageUrl,
    attribution: attributionOf(answer.attribution),
    credit: creditOf(answer.credit),
    quota: quotaOf(answer.quota),
  };
}

/** What is left of today's pictures from links before anything is sent; null when it is not said. */
export async function linkQuota(client: ApiClient): Promise<LinkQuota | null> {
  const answer = await client.request<{ quota?: unknown }>("GET", "/lists/pictures/link");
  return quotaOf(answer.quota);
}
