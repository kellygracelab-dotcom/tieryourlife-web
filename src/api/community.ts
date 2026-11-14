import type { AccountAction, ApiClient } from "./client";
import { itemsOf } from "./lists";
import type { Topic } from "./sections";
import type { PictureAttribution } from "./pictureAttribution";
import type { PublishedItem } from "./types";

/**
 * The proxy's reasons, in the order the app's report sheet shows them. The
 * last one never hides a list: a list in the wrong place is moved, not hidden.
 */
export const REPORT_REASONS = [
  "sexual",
  "violence",
  "hate",
  "spam",
  "other",
  "wrong_category",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * What the report dialog offers, as the app's ReportReason.offered: the
 * dialog hides what it reports, and a list in the wrong place is not hidden.
 */
export const OFFERED_REASONS: readonly ReportReason[] = REPORT_REASONS.filter(
  (reason) => reason !== "wrong_category",
);

/** A note longer than this is cut by the backend anyway. */
export const REPORT_NOTE_MAX = 500;

export interface ReportRequest {
  reason: ReportReason;
  note: string | null;
}

/** One complaint per person per list; the backend answers 204 either way. */
export function report(client: ApiClient, id: string, request: ReportRequest): Promise<void> {
  return client.request<void>("POST", `/lists/${encodeURIComponent(id)}/report`, {
    body: request,
  });
}

export interface FollowState {
  following: boolean;
  followers: number;
}

export function followState(client: ApiClient, authorUid: string): Promise<FollowState> {
  return client.request<FollowState>("GET", `/lists/follow/${encodeURIComponent(authorUid)}`);
}

export function followAuthor(client: ApiClient, authorUid: string): Promise<{ following: true }> {
  return client.request<{ following: true }>(
    "POST",
    `/lists/follow/${encodeURIComponent(authorUid)}`,
  );
}

export function unfollowAuthor(
  client: ApiClient,
  authorUid: string,
): Promise<{ following: false }> {
  return client.request<{ following: false }>(
    "DELETE",
    `/lists/follow/${encodeURIComponent(authorUid)}`,
  );
}

/**
 * One reader's placing of a list's cards: for each card, in the list's
 * order, the tier they gave it, or null for one they left unranked.
 */
export interface ReaderRanking {
  uid: string;
  authorName: string;
  authorPhotoUrl: string | null;
  arrangement: (number | null)[];
  /**
   * The cards in each tier, left to right, by their place in the list. Empty
   * for a ranking kept before the backend kept the order inside a tier: the
   * arrangement is then all there is of it. Only ever the list's own cards.
   */
  rows: number[][];
  /** The words they gave the tiers; a tier without one keeps the author's. */
  tierLabels: string[];
  updatedAtMs: number;
  /** The caller's own, in its place among the rest (CONTRACT K1). */
  mine: boolean;
  /**
   * The list's author's own arrangement, which heads the first page when it
   * is asked for (`withAuthor=1`). Its uid is "" on an anonymous list.
   */
  isAuthor?: boolean;
  /** Whether the caller likes it; how many others do is never said (K2). */
  likedByMe?: boolean;
  /** Cards the reader added of their own (K3), as the backend keeps them. */
  addedCards?: PublishedItem[];
  /**
   * The rows with the added cards in them: `N + k` is `addedCards[k]`, N the
   * list's cards. Drawn in place of `rows` when it is there.
   */
  allRows?: number[][];
}

/** One's own placing of a list as the backend kept it among the list's rankings; `created` when it was not there before. */
export type ShownRanking = ReaderRanking & { created?: boolean };

export interface RankingsPage {
  rankings: ReaderRanking[];
  nextCursor: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPosition = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Rows as numbers in rows: anything else in them is no card. */
const rowsIn = (value: unknown): number[][] =>
  Array.isArray(value)
    ? value.map((row: unknown) => (Array.isArray(row) ? row.filter(isPosition) : []))
    : [];

/**
 * A ranking however it arrived, or null for nothing that is one: each field
 * read on its own, so one gone wrong (or one an older backend never sends)
 * leaves the rest drawn.
 */
export function readerRankingOf(value: unknown): ShownRanking | null {
  if (!isRecord(value) || typeof value.uid !== "string") return null;
  const addedCards = Array.isArray(value.addedCards) ? itemsOf(value.addedCards) : [];
  return {
    uid: value.uid,
    authorName: typeof value.authorName === "string" ? value.authorName : "",
    authorPhotoUrl:
      typeof value.authorPhotoUrl === "string" && value.authorPhotoUrl !== ""
        ? value.authorPhotoUrl
        : null,
    arrangement: Array.isArray(value.arrangement)
      ? value.arrangement.map((tier: unknown) => (isPosition(tier) ? tier : null))
      : [],
    rows: rowsIn(value.rows),
    tierLabels: Array.isArray(value.tierLabels)
      ? value.tierLabels.map((label: unknown) => (typeof label === "string" ? label : ""))
      : [],
    updatedAtMs:
      typeof value.updatedAtMs === "number" && Number.isFinite(value.updatedAtMs)
        ? value.updatedAtMs
        : 0,
    mine: value.mine === true,
    ...(value.isAuthor === true ? { isAuthor: true } : {}),
    likedByMe: value.likedByMe === true,
    ...(addedCards.length === 0 ? {} : { addedCards }),
    ...(addedCards.length === 0 || !Array.isArray(value.allRows)
      ? {}
      : { allRows: rowsIn(value.allRows) }),
    ...(value.created === true ? { created: true } : {}),
  };
}

/** A page of rankings as the site reads it: what is not a ranking is left out. */
export function rankingsPageOf(value: unknown): RankingsPage {
  const page = isRecord(value) ? value : {};
  return {
    rankings: Array.isArray(page.rankings)
      ? page.rankings.flatMap((one: unknown) => {
          const ranking = readerRankingOf(one);
          return ranking === null ? [] : [ranking];
        })
      : [],
    nextCursor:
      typeof page.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : null,
  };
}

/**
 * The list's rankings in the backend's order, thirty at a time (CONTRACT
 * K1): the author first, then the most liked, the newer first among equals,
 * one's own in its place. 409 CURSOR_GONE for a cursor it no longer reads.
 */
export async function loadListRankings(
  client: ApiClient,
  listId: string,
  after: string | null = null,
): Promise<RankingsPage> {
  return rankingsPageOf(
    await client.request<unknown>("GET", `/lists/${encodeURIComponent(listId)}/rankings`, {
      query: after === null ? { withAuthor: "1" } : { withAuthor: "1", after },
    }),
  );
}

/**
 * Likes somebody's ranking of a list, or takes the like back (CONTRACT K2).
 * Asking twice is safe. 403 for a guest or a ban, 404 for a ranking that is
 * gone, 409 CANNOT_LIKE for one's own or the author's, 429 LIKE_LIMIT.
 */
export async function likeListRanking(
  client: ApiClient,
  listId: string,
  uid: string,
  like: boolean,
): Promise<{ likedByMe: boolean }> {
  const answer = await client.request<unknown>(
    like ? "PUT" : "DELETE",
    `/lists/${encodeURIComponent(listId)}/rankings/${encodeURIComponent(uid)}/like`,
  );
  return {
    likedByMe: isRecord(answer) && typeof answer.likedByMe === "boolean" ? answer.likedByMe : like,
  };
}

/**
 * Rows of card positions as the backend takes them: one row per tier, every
 * position inside the list, each card once. A board's rows can name a card
 * the list no longer has, or miss a tier, and the backend refuses either.
 */
export function rowsOf(
  rows: readonly (readonly number[])[],
  tierCount: number,
  itemCount: number,
): number[][] {
  const seen = new Set<number>();
  return Array.from({ length: tierCount }, (_, tier) =>
    (rows[tier] ?? []).filter((item) => {
      const fits = Number.isInteger(item) && item >= 0 && item < itemCount && !seen.has(item);
      if (fits) seen.add(item);
      return fits;
    }),
  );
}

/**
 * Puts the caller's placing among the list's rankings, as the app does, or
 * replaces the one there, with the order inside each tier. Not for a guest,
 * and not on one's own list.
 */
export async function keepListRanking(
  client: ApiClient,
  listId: string,
  placing: {
    tierLabels: (string | null)[];
    rows: number[][];
    version?: number;
    /** One's own cards (K3), `N + k` in the rows; left out, the ranking keeps none. */
    addedCards?: AddedCard[];
  },
  action: AccountAction,
): Promise<ShownRanking> {
  const answer = await client.request<unknown>(
    "PUT",
    `/lists/${encodeURIComponent(listId)}/rankings/mine`,
    { body: placing, action },
  );
  // An answer that is no ranking still says it went in: what was sent is what is shown.
  return (
    readerRankingOf(answer) ?? {
      uid: "",
      authorName: "",
      authorPhotoUrl: null,
      arrangement: [],
      rows: placing.rows,
      tierLabels: placing.tierLabels.map((label) => label ?? ""),
      updatedAtMs: Date.now(),
      mine: true,
    }
  );
}

/** At most this many cards of one's own go with a ranking (K3). */
export const ADDED_CARDS_MAX = 50;

/** A card of one's own in a ranking, as a card goes in a publish, without its place. */
export interface AddedCard {
  title: string;
  imageUrl?: string | null;
  pictureId?: string | null;
  attribution?: PictureAttribution;
  credit?: string;
}

/** Takes the caller's own placing of a list down; the backend answers 204 either way. */
export function withdrawListRanking(client: ApiClient, listId: string): Promise<void> {
  return client.request<void>("DELETE", `/lists/${encodeURIComponent(listId)}/rankings/mine`);
}

export interface SuggestedAuthor {
  uid: string;
  name: string;
  photoUrl: string | null;
  takeCount: number;
}

/** Authors worth following, by how often their lists are taken; never oneself or anyone followed. */
export function suggestedAuthors(client: ApiClient): Promise<{ authors: SuggestedAuthor[] }> {
  return client.request<{ authors: SuggestedAuthor[] }>("GET", "/lists/follow");
}

/** Somebody this person follows, with the name and face their newest list carries. */
export interface FollowedAuthor {
  uid: string;
  name: string;
  photoUrl: string | null;
}

/** A section this person follows, with how many others do. */
export interface FollowedSection {
  id: string;
  followerCount: number;
}

/** Everyone and everything this person follows: people, topics and sections. */
export interface Following {
  authors: FollowedAuthor[];
  topics: Topic[];
  sections: FollowedSection[];
}

export async function loadFollowing(client: ApiClient): Promise<Following> {
  const answer = await client.request<Partial<Following>>("GET", "/lists/following");
  return {
    authors: answer.authors ?? [],
    topics: answer.topics ?? [],
    sections: answer.sections ?? [],
  };
}

/**
 * One of the person's own uploaded pictures becomes their face: the backend
 * checks it and keeps a copy where everybody may see it. 422 PICTURE_REFUSED
 * when the picture cannot be a face.
 */
export function makeFace(client: ApiClient, pictureId: string): Promise<{ url: string }> {
  return client.request<{ url: string }>("POST", `/lists/face/${encodeURIComponent(pictureId)}`);
}

/**
 * Says a search found nothing in sections, topics or lists. The backend keeps
 * only the words and a count, never who typed them.
 */
export function noteSearchMiss(client: ApiClient, q: string): Promise<void> {
  return client.request<void>("POST", "/lists/search-misses", { body: { q } });
}
