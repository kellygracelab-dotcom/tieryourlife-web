import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../api/errors";
import type { FeedPage, FeedQuery, ListSummary } from "../../api/types";
import { loadFeed } from "../../lib/api";
import { errorOf } from "../../api/errors";
import { onListChanged } from "../../lib/listChanges";
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
      /**
       * The page last read on this device, kept on screen because the fresh
       * one could not be had: the app keeps its lists too, and says so.
       */
      stale?: boolean;
    };

type Ready = Extract<FeedState, { status: "ready" }>;

const LOADING: FeedState = { status: "loading" };

/** How many pages of nothing new Show more reads on its own before it is offered again. */
export const PAGES_READ_ON = 5;

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

/**
 * A list as anybody may keep it: `mine` was said to whoever was signed in
 * then, and on a shared browser the next person would wear somebody else's
 * anonymous list as their own until the fresh page came.
 */
const nobodys = ({ mine: _mine, ...list }: ListSummary): ListSummary => list;

/** A kept first page as this site can draw it, or nothing. */
export function readRememberedPage(kept: unknown): RememberedPage | null {
  if (!isRecord(kept) || !Array.isArray(kept.lists) || !kept.lists.every(isCardable)) return null;
  if (kept.next !== null && typeof kept.next !== "string") return null;
  return { lists: kept.lists.map(nobodys), next: kept.next };
}

/** The last few feeds' first pages, on this device. */
export const feedMemory: Remembered<RememberedPage> = remembered(
  localStorageStore,
  "tyl:feed",
  12,
  readRememberedPage,
);

/**
 * The pages a feed was shown beyond its first, for this visit: Back to it
 * draws them again under the fresh first page, so the place one read at is
 * still there. A feed asked for afresh (Try again) starts from its first.
 */
const furtherPages = new Map<string, RememberedPage>();

export function forgetFurtherPagesForTests(): void {
  furtherPages.clear();
}

/** A first page with the further pages read after it, each list once. */
function withFurther(key: string, first: RememberedPage): RememberedPage {
  const further = furtherPages.get(key);
  if (further === undefined) return first;
  const seen = new Set<string>();
  const once = (list: ListSummary) => {
    if (seen.has(list.id)) return false;
    seen.add(list.id);
    return true;
  };
  return { lists: [...first.lists, ...further.lists].filter(once), next: further.next };
}

// A list taken down or sent again from here is no longer as any kept page
// has it: those pages go, and the feed waits for the fresh one instead of
// offering what is gone or showing one's own change undone.
onListChanged((listId) => {
  const holds = (page: RememberedPage) => page.lists.some((list) => list.id === listId);
  feedMemory.forget(holds);
  for (const [key, page] of furtherPages) if (holds(page)) furtherPages.delete(key);
});

const readyFrom = (page: RememberedPage, stale: boolean): FeedState => ({
  status: "ready",
  lists: page.lists,
  next: page.next,
  more: "idle",
  followingNobody: false,
  stale,
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
  const recalled = useMemo(() => {
    const first = kept?.recall(key) ?? null;
    return first === null ? null : withFurther(key, first);
  }, [kept, key]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Whatever was loaded for another query or an earlier attempt reads as
  // loading, unless this query was read before: then that, until the fresh
  // one. Another try after a failure keeps the kept page up meanwhile.
  const keptUp =
    loaded !== null && loaded.key === key && loaded.state.status === "ready" && loaded.state.stale;
  const state: FeedState =
    loaded !== null && loaded.key === key && loaded.attempt === attempt
      ? loaded.state
      : recalled !== null && (attempt === 0 || keptUp === true)
        ? readyFrom(recalled, attempt !== 0)
        : LOADING;

  useEffect(() => {
    let current = true;
    const settle = (next: FeedState) => current && setLoaded({ key, attempt, state: next });
    // A page read before stays when the fresh one fails: lists to read beat a
    // bare "No connection".
    const failed = (reason: unknown): FeedState =>
      recalled !== null ? readyFrom(recalled, true) : { status: "error", error: errorOf(reason) };
    load(stable).then(
      (page) => {
        kept?.keep(key, { lists: page.lists.map(nobodys), next: page.nextCursor });
        const shown = withFurther(key, { lists: page.lists, next: page.nextCursor });
        settle({
          status: "ready",
          lists: shown.lists,
          next: shown.next,
          more: "idle",
          followingNobody: page.followingNobody === true,
        });
      },
      (reason: unknown) => settle(failed(reason)),
    );
    return () => {
      current = false;
    };
  }, [stable, key, load, attempt, kept, recalled]);

  const retry = useCallback(() => {
    furtherPages.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);

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
    // The backend reads the list a page ended at afresh, so a list whose
    // count changed meanwhile comes again: each list is shown once, as in the
    // app, and a page of nothing new is read past, a few at most.
    const shown = new Set(state.lists.map((list) => list.id));
    const from = (cursor: string | null, left: number): Promise<FeedPage> =>
      load(cursor === null ? stable : { ...stable, after: cursor }).then((page) => {
        const lists = page.lists.filter((list) => {
          if (shown.has(list.id)) return false;
          shown.add(list.id);
          return true;
        });
        const next = page.nextCursor !== cursor ? page.nextCursor : null;
        return lists.length === 0 && next !== null && left > 0
          ? from(next, left - 1)
          : { ...page, lists, nextCursor: next };
      });
    const settle = (page: FeedPage) => {
      // Somebody's own Following feed is not kept, not even for the visit.
      if (kept !== null) {
        const further = furtherPages.get(key);
        furtherPages.set(key, {
          lists: [...(further?.lists ?? []), ...page.lists],
          next: page.nextCursor,
        });
      }
      patch((now) => ({
        status: "ready",
        lists: [...now.lists, ...page.lists],
        next: page.nextCursor,
        more: "idle",
        followingNobody: now.followingNobody,
      }));
    };
    const failed = () => patch((now) => ({ ...now, more: "failed" }));
    from(after, PAGES_READ_ON).then(settle, (reason: unknown) => {
      // The list the page ended at was taken down: read again from the top,
      // keeping what is on screen, as the admin's panes do.
      if (errorOf(reason).kind === "cursorGone") from(null, PAGES_READ_ON).then(settle, failed);
      else failed();
    });
  }, [state, key, stable, load, kept]);

  return { state, retry, more };
}
