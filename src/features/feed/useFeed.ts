import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { loadFeed } from "../../lib/api";
import { errorOf } from "../list/useResource";

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

interface Loaded {
  key: string;
  attempt: number;
  state: FeedState;
}

/** One feed query: its first page on mount and when the query changes, further pages on demand. */
export function useFeed(query: FeedQuery, load: LoadFeed = loadFeed) {
  // The query travels as a string so a fresh object literal on each render does not refetch.
  const key = JSON.stringify(query);
  const stable = useMemo(() => JSON.parse(key) as FeedQuery, [key]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Whatever was loaded for another query or an earlier attempt reads as loading.
  const state: FeedState =
    loaded !== null && loaded.key === key && loaded.attempt === attempt ? loaded.state : LOADING;

  useEffect(() => {
    let current = true;
    const settle = (state: FeedState) => current && setLoaded({ key, attempt, state });
    load(stable).then(
      (page) =>
        settle({
          status: "ready",
          lists: page.lists,
          next: page.nextCursor,
          more: "idle",
          followingNobody: page.followingNobody === true,
        }),
      (reason: unknown) => settle({ status: "error", error: errorOf(reason) }),
    );
    return () => {
      current = false;
    };
  }, [stable, key, load, attempt]);

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
