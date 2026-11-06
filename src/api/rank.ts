import type { ApiClient } from "./client";
import { itemsOf, tiersOf } from "./lists";
import type { PublishedItem, PublishedList, PublishedTier } from "./types";

export interface RankingSnapshot {
  title: string;
  /** The list stands without an author, and the ranking names nobody. */
  editorial?: boolean;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  tiers: PublishedTier[];
  items: PublishedItem[];
  /** A house list's words in other languages, kept with the ranking; absent on older ones. */
  translations?: PublishedList["translations"];
  names?: PublishedList["names"];
}

/**
 * The words a reader gave the tiers, one per tier, null where a tier keeps
 * the list's own: a version started from another reader's placing keeps them.
 */
export type TierWords = readonly (string | null)[];

/**
 * The longest tier word the site's functions keep on a ranking. The editors
 * let a list's tiers carry up to 80, and a reader's ranking keeps whatever
 * words the list had, so a version started from that placing would otherwise
 * be refused on every Finish and every Try again.
 */
export const RANKING_TIER_WORD_MAX = 40;

/** Each word as the functions will take it: trimmed, and cut short where it is longer. */
export function tierWordsToSend(words: TierWords): (string | null)[] {
  return words.map((word) => {
    if (word === null) return null;
    const said = word.trim();
    if (said.length <= RANKING_TIER_WORD_MAX) return said;
    const cut = said.slice(0, RANKING_TIER_WORD_MAX);
    // Never half a character: a cut through a surrogate pair drops its first half too.
    const last = cut.charCodeAt(cut.length - 1);
    return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
  });
}

export interface Ranking {
  code: string;
  listId: string;
  listAvailable: boolean;
  snapshot: RankingSnapshot;
  rows: number[][];
  createdAt: number;
  /** Set when the caller's account keeps this ranking; pages made before it asked never carry it. */
  yours?: boolean;
}

export interface SavedRanking {
  code: string;
  claimToken: string;
}

/**
 * `version` is the list's updatedAt as the rows were placed on it: the
 * server refuses them (409 LIST_CHANGED) once the list was republished since.
 */
export function keepRanking(
  client: ApiClient,
  listId: string,
  rows: readonly (readonly number[])[],
  version?: number,
  tierLabels?: TierWords,
): Promise<SavedRanking> {
  return client.request<SavedRanking>("POST", "/api/rank", {
    body: {
      listId,
      rows: rows.map((row) => [...row]),
      ...(version === undefined ? {} : { version }),
      ...(tierLabels === undefined ? {} : { tierLabels: tierWordsToSend(tierLabels) }),
    },
  });
}

/** Read as an account when there is one, so the answer can say whether it is yours. */
export async function loadRanking(
  client: ApiClient,
  code: string,
  asAccount = false,
): Promise<Ranking> {
  return rankingOf(
    await client.request<Ranking>(
      "GET",
      `/api/rank/${encodeURIComponent(code)}`,
      asAccount ? {} : { auth: "appCheckOnly" },
    ),
  );
}

/**
 * A ranking as the site draws it, however it arrived: rows that are not rows
 * are none, and the list's snapshot is read as a list is, so one field gone
 * wrong leaves the rest drawn instead of the page.
 */
export function rankingOf(ranking: Ranking): Ranking {
  const snapshot: Partial<RankingSnapshot> =
    ranking.snapshot !== null && typeof ranking.snapshot === "object" ? ranking.snapshot : {};
  return {
    ...ranking,
    rows: Array.isArray(ranking.rows)
      ? ranking.rows.map((row: unknown) => (Array.isArray(row) ? (row as number[]) : []))
      : [],
    snapshot: {
      ...snapshot,
      title: typeof snapshot.title === "string" ? snapshot.title : "",
      authorName: typeof snapshot.authorName === "string" ? snapshot.authorName : "",
      authorPhotoUrl: typeof snapshot.authorPhotoUrl === "string" ? snapshot.authorPhotoUrl : null,
      category: typeof snapshot.category === "string" ? snapshot.category : "",
      tiers: tiersOf(snapshot.tiers),
      items: itemsOf(snapshot.items),
    },
  };
}

export function rearrangeRanking(
  client: ApiClient,
  code: string,
  rows: readonly (readonly number[])[],
  tierLabels?: TierWords,
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PUT", `/api/rank/${encodeURIComponent(code)}`, {
    body: {
      rows: rows.map((row) => [...row]),
      ...(tierLabels === undefined ? {} : { tierLabels: tierWordsToSend(tierLabels) }),
    },
  });
}

export function claimKept(
  client: ApiClient,
  code: string,
  claimToken: string,
): Promise<{ code: string }> {
  return client.request<{ code: string }>("PATCH", `/api/rank/${encodeURIComponent(code)}`, {
    body: { claimToken },
  });
}

/** Takes a kept ranking away for good; only the account that keeps it may. */
export function removeRanking(client: ApiClient, code: string): Promise<void> {
  return client.request<void>("DELETE", `/api/rank/${encodeURIComponent(code)}`);
}

export interface RankingSummary {
  code: string;
  listId: string;
  title: string;
  authorName: string;
  authorPhotoUrl: string | null;
  category: string;
  placed: number;
  itemCount: number;
  imageUrl: string | null;
  createdAt: number;
}

export interface MyRankings {
  rankings: RankingSummary[];
  // The server stops at a fixed number; true means there were rankings beyond it.
  more: boolean;
}

export function loadMyRankings(client: ApiClient): Promise<MyRankings> {
  return client.request<MyRankings>("GET", "/api/me/rankings");
}
