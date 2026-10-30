import type { ApiClient } from "./client";
import type { Topic } from "./sections";

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
   * arrangement is then all there is of it.
   */
  rows: number[][];
  /** The words they gave the tiers; a tier without one keeps the author's. */
  tierLabels: string[];
  updatedAtMs: number;
  /** The caller's own, which leads the first page. */
  mine: boolean;
}

export interface RankingsPage {
  rankings: ReaderRanking[];
  nextCursor: string | null;
}

/** Newest first, thirty at a time; the caller's own leads the first page. */
export function loadListRankings(
  client: ApiClient,
  listId: string,
  after: string | null = null,
): Promise<RankingsPage> {
  return client.request<RankingsPage>(
    "GET",
    `/lists/${encodeURIComponent(listId)}/rankings`,
    after === null ? {} : { query: { after } },
  );
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
export function keepListRanking(
  client: ApiClient,
  listId: string,
  placing: { tierLabels: string[]; rows: number[][] },
): Promise<ReaderRanking> {
  return client.request<ReaderRanking>(
    "PUT",
    `/lists/${encodeURIComponent(listId)}/rankings/mine`,
    {
      body: placing,
    },
  );
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
