import { useCallback, useEffect, useRef, useState } from "react";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { errorOf } from "../../api/errors";
import { loadListRankings, withdrawListRanking } from "../../lib/api";
import { readersOf } from "./rankings";

/** How many pages that bring nobody new are read on their own before Show more is offered again. */
export const PAGES_READ_ON = 5;

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
  /** This reader's own, just shown to others: first, in place of the one there before. */
  put: (ranking: ReaderRanking) => void;
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
      const shown = new Set(current.current.rankings.map((ranking) => ranking.uid));
      const isNew = (ranking: ReaderRanking) => !shown.has(ranking.uid);
      // A page can bring nobody new with more behind it: the backend skips
      // visitors' rankings after paging, and a page read again repeats rows.
      // Nobody is made to press for it, but only a few pages are read on their
      // own, and never the same cursor twice.
      const from = (cursor: string | null, left: number): Promise<RankingsPage> =>
        deps.load(listId, cursor).then((page) => {
          // A reply without the field has nothing behind it.
          const next = page.nextCursor ?? null;
          const moved = next !== cursor ? next : null;
          return !readersOf(page.rankings).some(isNew) && moved !== null && left > 0
            ? from(moved, left - 1)
            : { ...page, nextCursor: moved };
        });
      const settle = (page: RankingsPage) =>
        setState((now) => {
          const known = new Set(now.rankings.map((ranking) => ranking.uid));
          // One row a reader, even when a page names somebody twice.
          const fresh: ReaderRanking[] = [];
          for (const ranking of readersOf(page.rankings)) {
            if (known.has(ranking.uid)) continue;
            known.add(ranking.uid);
            fresh.push(ranking);
          }
          return {
            ...now,
            status: "ready",
            rankings: [...now.rankings, ...fresh],
            next: page.nextCursor,
            more: "idle",
          };
        });
      const failed = () =>
        setState((now) =>
          after === null ? { ...now, status: "failed" } : { ...now, more: "failed" },
        );
      from(after, PAGES_READ_ON).then(settle, (reason: unknown) => {
        // The reader the page ended at took theirs back: read again from the
        // top, keeping the rows here, as the admin's panes do.
        if (after !== null && errorOf(reason).kind === "cursorGone") {
          from(null, PAGES_READ_ON).then(settle, failed);
        } else {
          failed();
        }
      });
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

  // Not read yet, the sheet reads it with the rest when it opens.
  const put = useCallback((ranking: ReaderRanking) => {
    setState((now) =>
      now.status !== "ready"
        ? now
        : {
            ...now,
            rankings: [
              { ...ranking, mine: true },
              ...now.rankings.filter((one) => !one.mine && one.uid !== ranking.uid),
            ],
            withdrawFailed: false,
          },
    );
  }, []);

  return { state, open, more, withdraw, put };
}
