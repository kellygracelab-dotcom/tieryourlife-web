import type { ApiClient } from "./client";
import type { CatalogueItem } from "./types";

/**
 * Where a card's picture is looked for, the backend choosing the catalogues
 * (proxy #57): TMDB for film, TV and people, AniList for anime, Steam for
 * games, Deezer for music, Open Library for books, Wikidata everywhere, and
 * in All the web too when the catalogues have little.
 */
export const PICTURE_SCOPES = [
  "all",
  "film_tv",
  "anime",
  "games",
  "music",
  "books",
  "people",
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
  "deezer",
  "openlibrary",
  "wikidata",
  "web",
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
  "thing",
  "web",
] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export interface FoundPicture extends CatalogueItem {
  imageUrl: string;
  /** A smaller copy for the grid; null when the picture is drawn from imageUrl itself. */
  thumbUrl: string | null;
  source: PictureSource;
  kind: PictureKind;
}

/** A quiet line over the results: the web is done for today, or for now. */
export type PictureNotice = "webDailyLimit" | "webOff";
const NOTICES: readonly string[] = ["webDailyLimit", "webOff"];

export interface PicturePage {
  items: FoundPicture[];
  /** More from the catalogues; the web answers on the first page only. */
  hasMore: boolean;
  notices: PictureNotice[];
}

export interface PictureAsk {
  q: string;
  scope: PictureScope;
  /** 1-based. */
  page: number;
  /** "Search everywhere": the web is asked even when the catalogues found plenty. */
  web: boolean;
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
    source: oneOf(PICTURE_SOURCES, item.source) ? item.source : "web",
    kind: oneOf(PICTURE_KINDS, item.kind) ? item.kind : "thing",
  };
}

export async function searchPictures(
  client: ApiClient,
  ask: PictureAsk & { lang: string },
): Promise<PicturePage> {
  const answer = await client.request<{ items?: unknown; hasMore?: unknown; notices?: unknown }>(
    "GET",
    "/lists/pictures",
    {
      query: {
        q: ask.q.trim().slice(0, MAX_PICTURE_QUERY),
        scope: ask.scope,
        lang: ask.lang,
        page: ask.page,
        ...(ask.web ? { web: 1 } : {}),
      },
    },
  );
  const items = Array.isArray(answer.items) ? answer.items : [];
  const notices = Array.isArray(answer.notices) ? answer.notices : [];
  return {
    items: items.map(pictureOf).filter((one): one is FoundPicture => one !== null),
    hasMore: answer.hasMore === true,
    // Codes this page does not know yet are left unsaid.
    notices: notices.filter((one): one is PictureNotice => NOTICES.includes(one as string)),
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
