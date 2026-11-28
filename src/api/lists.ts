import { focusOf, type CoverFocus } from "./coverFocus";
import type { AccountAction, ApiClient } from "./client";
import { cardTitleOf } from "./cardTitle";
import {
  attributionField,
  catalogueCreditOf,
  editorCreditOf,
  type ManualCredit,
  type PictureAttribution,
} from "./pictureAttribution";
import type {
  FeedPage,
  FeedQuery,
  ListSource,
  ListSummary,
  PublishedItem,
  PublishedList,
  PublishedTier,
} from "./types";

export async function loadList(client: ApiClient, id: string): Promise<PublishedList> {
  return publishedListOf(
    await client.request<PublishedList>("GET", `/lists/${encodeURIComponent(id)}`, {
      auth: "reader",
    }),
  );
}

/** One list as the site draws it, however it arrived: asked for, or already in the page. */
export const publishedListOf = (list: PublishedList): PublishedList => {
  const { coverAttribution, revision, ...rest } = list;
  // The cover's credit is the cover picture's: none on a list drawn without one.
  const covered = pictureOf(list.coverImageUrl) !== null;
  const coverCredit = covered ? editorCreditOf(coverAttribution) : null;
  const coverCatalogue =
    covered && coverCredit !== null ? catalogueCreditOf(coverAttribution) : null;
  return {
    ...summaryOf(rest),
    authorName: textOf(list.authorName),
    tiers: tiersOf(list.tiers),
    items: itemsOf(list.items),
    ...(coverCredit === null ? {} : { coverAttribution: coverCredit }),
    ...(coverCatalogue === null ? {} : { coverCatalogue }),
    ...revisionField(revision),
  };
};

/** A list's revision as the backend says it: a whole number from 0, else not known. */
export const revisionOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const revisionField = (value: unknown): { revision?: number } => {
  const revision = revisionOf(value);
  return revision === undefined ? {} : { revision };
};

/** A write's answer with the revision the list now has, when it says one the site can read. */
export const withRevision = <T extends { revision?: number }>(answer: T): T => {
  const { revision, ...rest } = answer;
  return { ...rest, ...revisionField(revision) } as T;
};

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
        const { attribution, pictureFocus: sent, ...card } = item as PublishedItem;
        const imageUrl =
          card.imageUrl === null || card.imageUrl === undefined ? null : pictureOf(card.imageUrl);
        // The attribution and the focus are the picture's: cleaned, and none on a card drawn without one.
        const pictureFocus = imageUrl === null ? null : focusOf(sent);
        return {
          ...card,
          // An old default name on a card with a picture is none (cardText).
          title: cardTitleOf(textOf(card.title), imageUrl !== null),
          imageUrl,
          ...attributionField(imageUrl, attribution),
          ...(pictureFocus === null ? {} : { pictureFocus }),
        };
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

/** The site's hosts, each answering /img/collage/ with the same picture. */
const COLLAGE_HOSTS: ReadonlySet<string> = new Set([
  "tieryourlife.com",
  "www.tieryourlife.com",
  "tieryourlife.web.app",
  "tieryourlife.firebaseapp.com",
]);
const COLLAGE_PATH = /^\/img\/collage\/[A-Za-z0-9_-]{8,64}\.webp$/;

/**
 * A list's collage as the site loads it: only the site's own
 * `/img/collage/{id}.webp` over https, on any of its hosts, given as its path
 * and query so the page asks its own origin; null for anything else. A path
 * read before stays as it is, so a list read twice keeps its collage.
 */
export function collageSrcOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const read = value.startsWith("/") && !value.startsWith("//");
  if (!read && !value.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(value, "https://tieryourlife.com");
  } catch {
    return null;
  }
  if (url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (!COLLAGE_HOSTS.has(url.hostname) || !COLLAGE_PATH.test(url.pathname)) return null;
  return url.pathname + url.search;
}

/** The longest source label the backend keeps (CONTRACT, MAX_LIST_SOURCE_LABEL). */
export const LIST_SOURCE_LABEL_MAX = 120;
/** The longest source address the backend keeps. */
export const LIST_SOURCE_URL_MAX = 500;

/** Whether an address is one a source may lead to: https, no login, no port, 500 characters at most. */
export function isSourceUrl(value: string): boolean {
  if (value.length > LIST_SOURCE_URL_MAX || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === "" && url.port === ""
    );
  } catch {
    return false;
  }
}

/** A house list's source as the site shows it: words to show and an https page, or null. */
export function listSourceOf(value: unknown): ListSource | null {
  if (typeof value !== "object" || value === null) return null;
  const { label, url } = value as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (typeof url !== "string" || !isSourceUrl(url)) return null;
  return value as ListSource;
}

/**
 * A list as the site draws it: its cover and previews only real pictures, a
 * focus only on a cover, a source only with words and an https page.
 */
export const summaryOf = <T extends ListSummary>(list: T): T => {
  const sent = list.previewImages ?? [];
  const kept = sent.flatMap((url, at) =>
    pictureOf(url) === null ? [] : [{ url, focus: focusOf(list.previewFocus?.[at]) }],
  );
  const previews = kept.map((preview) => preview.url);
  const previewFocus = kept.some((preview) => preview.focus !== null)
    ? kept.map((preview) => preview.focus)
    : null;
  const cover = pictureOf(list.coverImageUrl);
  const focus = cover === null ? null : focusOf(list.coverFocus);
  const source = listSourceOf(list.listSource);
  const collage = collageSrcOf(list.collageUrl);
  if (
    (list.collageUrl ?? null) === collage &&
    previews.length === list.previewImages?.length &&
    list.previewFocus === undefined &&
    previewFocus === null &&
    cover === list.coverImageUrl &&
    (list.coverFocus ?? null) === focus &&
    (list.listSource ?? null) === source
  ) {
    return list;
  }
  const {
    coverFocus: _sent,
    listSource: _source,
    previewFocus: _previewFocus,
    collageUrl: _collage,
    ...rest
  } = list;
  return {
    ...rest,
    ...(collage === null ? {} : { collageUrl: collage }),
    previewImages: previews,
    ...(previewFocus === null ? {} : { previewFocus }),
    coverImageUrl: cover,
    ...(focus === null ? {} : { coverFocus: focus }),
    ...(source === null ? {} : { listSource: source }),
  } as T;
};

/**
 * How long the feed waits for the browser's App Check: a feed that is not
 * there after this says why and offers Try again (audit A1, at most 5–6 s).
 */
export const FEED_CHECK_WAIT_MS = 5_000;

export async function loadFeed(client: ApiClient, query: FeedQuery = {}): Promise<FeedPage> {
  const page = await client.request<FeedPage>("GET", "/lists", {
    query,
    // Followed lists are somebody's; every other feed is anybody's to read.
    auth: query.following === true ? "user" : "reader",
    appCheckWaitMs: FEED_CHECK_WAIT_MS,
  });
  return { ...page, lists: (page.lists ?? []).map(summaryOf) };
}

/**
 * The newest lists of people, for Explore's row over Popular (Proxy #192):
 * the server picks them (14 days, a picture on most cards, at most 3 a
 * person, up to 12), one page and never a cursor.
 */
export async function loadFresh(client: ApiClient): Promise<ListSummary[]> {
  const page = await client.request<{ lists?: ListSummary[] }>("GET", "/lists", {
    query: { fresh: true },
    auth: "reader",
    appCheckWaitMs: FEED_CHECK_WAIT_MS,
  });
  return (page.lists ?? []).map(summaryOf);
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
  /**
   * Out by its link but in no feed until staff approve it (CONTRACT, Approval
   * before the feed, 26.11.2026); absent once it is, and on older backends.
   */
  awaitingApproval?: boolean;
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
  /** Which part of the single cover shows; null for the middle (CONTRACT, Cover focus). */
  coverFocus?: CoverFocus | null;
  /**
   * A house publication only: the editor's credit for the cover; null takes
   * it off, absent keeps the one the same cover had (CONTRACT, Editor's credit).
   */
  coverAttribution?: ManualCredit | null;
  /**
   * A house publication only: where its cards came from; null takes it away,
   * absent keeps the one the list has (CONTRACT, A house list's source).
   */
  listSource?: ListSource | null;
  /** An approved topic of the list's section, which files the list under it; null for none. */
  topicId?: string | null;
  /** True takes the list out of its topic; a null topicId alone keeps the old one. */
  noTopic?: boolean;
  /**
   * A topic of the person's own to propose, one to forty characters: it
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
  /**
   * The published list the cards were saved from, as the app sends it: the
   * backend credits it, or keeps the publish as a ranking of it.
   */
  takenFrom?: string;
  sourceVersion?: number;
  /**
   * The list's revision the board was read at, on a replace (CONTRACT, List
   * revision): when the list has moved on since, the backend writes nothing
   * and answers 409 LIST_CHANGED with the one it has. Left out, not checked.
   */
  baseRevision?: number;
  tiers: PublishedTier[];
  items: {
    sourceIndex?: number;
    title: string;
    imageUrl: string | null;
    pictureId: string | null;
    /** Left out when the picture names nobody. */
    credit?: string;
    /**
     * Sent back as the card keeps it; the backend reads only its `link` and
     * `originalUrl` (which keeps a catalogue copy's name) and works out the
     * rest, except a house editor's own credit (`manual`).
     */
    attribution?: PictureAttribution;
    /** Where the card's picture is looked at; null for its default (CONTRACT, Cover focus). */
    pictureFocus?: CoverFocus | null;
    tierIndex: number | null;
  }[];
}

/**
 * Where a publish landed. `ranking` is true when the backend kept it as the
 * caller's ranking of the list it was taken from, whose id `id` is then.
 */
export interface Published {
  id: string;
  /**
   * How many pictures from other sites the backend could not fetch or check
   * in time and left out (QA S11); absent when none were. Publishing again
   * tries them again.
   */
  droppedPictures?: number;
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
  /**
   * Out by its link but in no feed until staff approve it (CONTRACT, Approval
   * before the feed, 26.11.2026); absent once it is, and on older backends.
   */
  awaitingApproval?: boolean;
  /** The list's revision after this write, or the existing list's; absent on a ranking. */
  revision?: number;
}

export function publish(
  client: ApiClient,
  request: PublishRequest,
  action?: AccountAction,
): Promise<Published> {
  return client.request<Published>("POST", "/lists", { body: request, action }).then(withRevision);
}

/** Replaces a published list in place: same id, same link, a fresh snapshot. */
export function republish(
  client: ApiClient,
  id: string,
  request: PublishRequest,
  action?: AccountAction,
): Promise<Published> {
  return client
    .request<Published>("POST", `/lists/${encodeURIComponent(id)}`, { body: request, action })
    .then(withRevision);
}

/** Takes the list out of the feed and off its address; the backend answers 204 either way. */
export function unpublish(client: ApiClient, id: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/${encodeURIComponent(id)}`);
}

export function recordTake(
  client: ApiClient,
  id: string,
  action?: AccountAction,
): Promise<{ counted: boolean }> {
  const path = `/lists/${encodeURIComponent(id)}/taken`;
  return action ? client.request("POST", path, { action }) : client.request("POST", path);
}
