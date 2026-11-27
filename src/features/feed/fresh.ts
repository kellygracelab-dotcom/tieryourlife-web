import { useEffect, useMemo, useState } from "react";
import type { ListSummary } from "../../api/types";
import type { Remembered } from "../../lib/remembered";
import { isOutOfSight, type Hidden } from "../community/hidden";
import { feedMemory, type FeedState, type RememberedPage } from "./useFeed";

export type LoadFresh = () => Promise<ListSummary[]>;

/** At most this many of people's newest lists stand first in Popular (Marketing, 23.11). */
export const FRESH_ON_TOP = 4;

/** Where the last answer is kept on the device, beside the feeds' first pages. */
export const FRESH_KEY = "fresh";

/**
 * People's newest lists, the server's pick (GET /lists?fresh=1): the last
 * answer from the device at once, so coming back draws Popular's top where it
 * was and nothing below it moves, then the new one. Nothing on a failure:
 * Popular stands as it is. A browser with no answer of its own draws
 * `standIn` (Community's first screen) until the new one comes.
 */
export function useFresh(
  load: LoadFresh,
  memory: Remembered<RememberedPage> | null = feedMemory,
  standIn: readonly ListSummary[] | null = null,
): readonly ListSummary[] {
  const [lists, setLists] = useState<ListSummary[] | null>(
    () => memory?.recall(FRESH_KEY)?.lists ?? null,
  );
  useEffect(() => {
    let current = true;
    load().then(
      (found) => {
        if (!current) return;
        memory?.keep(FRESH_KEY, {
          lists: found.map(({ mine: _mine, ...list }) => list),
          next: null,
        });
        setLists(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [load, memory]);
  return lists ?? standIn ?? NONE;
}

const NONE: readonly ListSummary[] = [];

/**
 * The first few of them a reader has not hidden, in the server's order. One
 * hidden during this visit keeps its place, where the grid offers Undo.
 */
export function freshOnTop(
  fresh: readonly ListSummary[],
  hidden: Hidden,
  hiddenThisVisit: readonly string[],
): ListSummary[] {
  return fresh
    .filter((list) => hiddenThisVisit.includes(list.id) || !isOutOfSight(hidden, list))
    .slice(0, FRESH_ON_TOP);
}

/**
 * Popular with the newest lists first (Marketing, 23.11): they stand above its
 * first page, and none of them shows again on any page of Popular. The cursor
 * stays the server's own, so Show more goes on where Popular left off; a page
 * shorter after the ones on top left it is as it should be.
 */
export function withFreshOnTop(state: FeedState, top: readonly ListSummary[]): FeedState {
  if (state.status !== "ready" || top.length === 0) return state;
  const onTop = new Set(top.map((list) => list.id));
  return { ...state, lists: [...top, ...state.lists.filter((list) => !onTop.has(list.id))] };
}

/** The ids drawn with "New", for the cards. */
export const useFreshIds = (top: readonly ListSummary[]): ReadonlySet<string> =>
  useMemo(() => new Set(top.map((list) => list.id)), [top]);
