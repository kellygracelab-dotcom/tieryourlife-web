import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { loadFeed } from "../../lib/api";
import { errorOf } from "../../api/errors";
import { remembered, type Remembered } from "../../lib/remembered";
import { localStorageStore } from "../../lib/storage";

export type FeedState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | {
      status: "ready";
      lists: ListSummary[];
      next: string | null;
      more: "idle" | "loading" | "failed";
      /** A Following feed of somebody who follows nobody yet. */
      followingNobody: boolean;
    };

type Ready = Extract<FeedState, { status: "ready" }>;

const LOADING: FeedState = { status: "loading" };

export type LoadFeed = (query: FeedQuery) => Promise<FeedPage>;

/** A first page as it was last read, to open with while the fresh one is on its way. */
export interface RememberedPage {
  lists: ListSummary[];
  next: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((one) => typeof one === "string");

/** A list a card can be drawn from: what the card reads, of the kind it reads. */
const isCardable = (list: unknown): list is ListSummary =>
  isRecord(list) &&
  typeof list.id === "string" &&
  typeof list.title === "string" &&
  typeof list.authorUid === "string" &&
  typeof list.authorName === "string" &&
  (list.authorPhotoUrl === null || typeof list.authorPhotoUrl === "string") &&
  typeof list.category === "string" &&
  typeof list.itemCount === "number" &&
  typeof list.takeCount === "number" &&
  (list.coverImageUrl === null || typeof list.coverImageUrl === "string") &&
  isStrings(list.previewImages) &&
  isStrings(list.tierColors);

/** A kept first page as this site can draw it, or nothing. */
export function readRememberedPage(kept: unknown): RememberedPage | null {
  if (!isRecord(kept) || !Array.isArray(kept.lists) || !kept.lists.every(isCardable)) return null;
  if (kept.next !== null && typeof kept.next !== "string") return null;
  return { lists: kept.lists, next: kept.next };
}

/** The last few feeds' first pages, on this device. */
export const feedMemory: Remembered<RememberedPage> = remembered(
  localStorageStore,
  "tyl:feed",
  12,
  readRememberedPage,
);

const readyFrom = (page: RememberedPage): FeedState => ({
  status: "ready",
  lists: page.lists,
  next: page.next,
  more: "idle",
  followingNobody: false,
});

interface Loaded {
  key: string;
  attempt: number;
  state: FeedState;
}

/**
 * One feed query: its first page on mount and when the query changes, further
 * pages on demand. The first page last read opens the feed at once, and the
 * fresh one takes its place; a Following feed is somebody's own and is never
 * kept.
 */
export function useFeed(
  query: FeedQuery,
  load: LoadFeed = loadFeed,
  memory: Remembered<RememberedPage> | null = feedMemory,
) {
  // The query travels as a string so a fresh object literal on each render does not refetch.
  const key = JSON.stringify(query);
  const stable = useMemo(() => JSON.parse(key) as FeedQuery, [key]);
  const kept = query.following === true ? null : memory;
  const recalled = useMemo(() => kept?.recall(key) ?? null, [kept, key]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Whatever was loaded for another query or an earlier attempt reads as
  // loading, unless this query was read before: then that, until the fresh one.
  const state: FeedState =
    loaded !== null && loaded.key === key && loaded.attempt === attempt
      ? loaded.state
      : attempt === 0 && recalled !== null
        ? readyFrom(recalled)
        : LOADING;

  useEffect(() => {
    let current = true;
    const settle = (next: FeedState) => current && setLoaded({ key, attempt, state: next });
    load(stable).then(
      (page) => {
        kept?.keep(key, { lists: page.lists, next: page.nextCursor });
        settle({
          status: "ready",
          lists: page.lists,
          next: page.nextCursor,
          more: "idle",
          followingNobody: page.followingNobody === true,
        });
      },
      (reason: unknown) => settle({ status: "error", error: errorOf(reason) }),
    );
    return () => {
      current = false;
    };
  }, [stable, key, load, attempt, kept]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const more = useCallback(() => {
    if (state.status !== "ready" || state.next === null || state.more === "loading") return;
    const after = state.next;
    // A page that arrives after the query moved on is dropped: its cursor no longer matches.
    const patch = (update: (now: Ready) => FeedState) =>
      setLoaded((now) =>
        now !== null && now.key === key && now.state.status === "ready" && now.state.next === after
          ? { ...now, state: update(now.state) }
          : now,
      );
    patch((now) => ({ ...now, more: "loading" }));
    load({ ...stable, after }).then(
      (page) =>
        patch((now) => ({
          status: "ready",
          lists: [...now.lists, ...page.lists],
          next: page.nextCursor,
          more: "idle",
          followingNobody: now.followingNobody,
        })),
      () => patch((now) => ({ ...now, more: "failed" })),
    );
  }, [state, key, stable, load]);

  return { state, retry, more };
}
