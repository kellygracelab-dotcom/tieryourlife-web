import { useCallback, useEffect, useRef, useState } from "react";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { loadListRankings, withdrawListRanking } from "../../lib/api";
import { readersOf } from "./rankings";

export interface RankingsDeps {
  load: (listId: string, after: string | null) => Promise<RankingsPage>;
  withdraw: (listId: string) => Promise<unknown>;
}

const defaultDeps: RankingsDeps = { load: loadListRankings, withdraw: withdrawListRanking };

export interface RankingsState {
  /** Nothing is read until the sheet first opens. */
  status: "idle" | "loading" | "ready" | "failed";
  /** This reader's own first, the rest newest first. */
  rankings: ReaderRanking[];
  /** Where the next page starts; null once there is none. */
  next: string | null;
  more: "idle" | "loading" | "failed";
  /** The last withdrawal did not go through, and the ranking is back. */
  withdrawFailed: boolean;
}

export interface Rankings {
  state: RankingsState;
  /** The first page, asked for once; again only after it failed. */
  open: () => void;
  more: () => void;
  /** This reader's own comes down at once, and back if the backend says no. */
  withdraw: () => void;
}

const NOTHING_YET: RankingsState = {
  status: "idle",
  rankings: [],
  next: null,
  more: "idle",
  withdrawFailed: false,
};

/**
 * The readers' placings of one list, the way the app keeps them beside the
 * list: read when somebody asks to see them, a page at a time, and this
 * reader's own taken down on request.
 */
export function useRankings(listId: string, deps: RankingsDeps = defaultDeps): Rankings {
  const [state, setState] = useState<RankingsState>(NOTHING_YET);
  // Read at the moment of a press rather than closed over, as useFollow does.
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  });

  const read = useCallback(
    (after: string | null) => {
      setState((now) =>
        after === null ? { ...now, status: "loading", more: "idle" } : { ...now, more: "loading" },
      );
      // A page can come back empty with more behind it: the backend skips
      // visitors' rankings after paging. Nobody is made to press for it.
      const from = (cursor: string | null): Promise<RankingsPage> =>
        deps
          .load(listId, cursor)
          .then((page) =>
            page.rankings.length === 0 && page.nextCursor !== null ? from(page.nextCursor) : page,
          );
      from(after).then(
        (page) => {
          setState((now) => {
            const known = new Set(now.rankings.map((ranking) => ranking.uid));
            const fresh = readersOf(page.rankings).filter((ranking) => !known.has(ranking.uid));
            return {
              ...now,
              status: "ready",
              rankings: [...now.rankings, ...fresh],
              next: page.nextCursor,
              more: "idle",
            };
          });
        },
        () =>
          setState((now) =>
            after === null ? { ...now, status: "failed" } : { ...now, more: "failed" },
          ),
      );
    },
    [listId, deps],
  );

  const open = useCallback(() => {
    const { status } = current.current;
    if (status === "idle" || status === "failed") read(null);
  }, [read]);

  const more = useCallback(() => {
    const { next, more: paging } = current.current;
    if (next !== null && paging !== "loading") read(next);
  }, [read]);

  const withdraw = useCallback(() => {
    const mine = current.current.rankings.find((ranking) => ranking.mine);
    if (mine === undefined) return;
    setState((now) => ({
      ...now,
      rankings: now.rankings.filter((ranking) => ranking !== mine),
      withdrawFailed: false,
    }));
    deps
      .withdraw(listId)
      .catch(() =>
        setState((now) => ({ ...now, rankings: [mine, ...now.rankings], withdrawFailed: true })),
      );
  }, [listId, deps]);

  return { state, open, more, withdraw };
}
