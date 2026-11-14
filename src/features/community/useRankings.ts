import { useCallback, useEffect, useRef, useState } from "react";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { errorOf, type ApiError } from "../../api/errors";
import { likeListRanking, loadListRankings, withdrawListRanking } from "../../lib/api";
import { readersOf } from "./rankings";

/** How many pages that bring nobody new are read on their own before Show more is offered again. */
export const PAGES_READ_ON = 5;

export interface RankingsDeps {
  load: (listId: string, after: string | null) => Promise<RankingsPage>;
  withdraw: (listId: string) => Promise<unknown>;
  like: (listId: string, uid: string, like: boolean) => Promise<{ likedByMe: boolean }>;
}

const defaultDeps: RankingsDeps = {
  load: loadListRankings,
  withdraw: withdrawListRanking,
  like: likeListRanking,
};

/**
 * Why a like did not go through, said beside the ranking it was for: sign in
 * first, a ban (as publishing says it), a ranking no longer there, or the
 * hour's likes used up until `retryAt`.
 */
export type LikeTrouble =
  | { uid: string; kind: "signIn" }
  | { uid: string; kind: "banned"; until: number | null }
  | { uid: string; kind: "gone" }
  | { uid: string; kind: "limit"; retryAt: number | null }
  | { uid: string; kind: "failed" };

/** What a refused like says, or null when it is simply undone: one's own or the author's (409). */
export function likeTroubleOf(uid: string, error: ApiError): LikeTrouble | null {
  switch (error.kind) {
    case "notSignedIn":
    case "unauthenticated":
      return { uid, kind: "signIn" };
    case "banned":
      return { uid, kind: "banned", until: error.until };
    case "notFound":
      return { uid, kind: "gone" };
    case "likeLimit":
      return { uid, kind: "limit", retryAt: error.retryAt ?? null };
    case "cannotLike":
    case "conflict":
      return null;
    default:
      return { uid, kind: "failed" };
  }
}

export interface RankingsState {
  /** Nothing is read until the sheet first opens. */
  status: "idle" | "loading" | "ready" | "failed";
  /**
   * The readers' rankings in the backend's order (K1): the most liked first,
   * the newer first among equals, this reader's own in its place. The
   * author's arrangement, which heads the first page, is the list itself.
   */
  rankings: ReaderRanking[];
  /** Where the next page starts; null once there is none. */
  next: string | null;
  more: "idle" | "loading" | "failed";
  /** The last withdrawal did not go through, and the ranking is back. */
  withdrawFailed: boolean;
  /**
   * Readers this page took from or added to the count the list came with:
   * one's own withdrawn, or shown to others where there was none. QA W51.
   */
  countChange: number;
  /** The last like that did not go through, until the next press. */
  likeTrouble: LikeTrouble | null;
  /** Rankings a like found gone (404): still drawn, with nothing more to press. */
  gone: readonly string[];
}

export interface Rankings {
  state: RankingsState;
  /** The first page, asked for once; again only after it failed or one's own moved. */
  open: () => void;
  more: () => void;
  /** This reader's own comes down at once, and back in its place if the backend says no. */
  withdraw: () => void;
  /**
   * This reader's own, just shown to others: in place of the one there
   * before, and one more on the count when the backend made a new one. A
   * new one's place is the backend's to say, so the rankings are read again.
   */
  put: (ranking: ReaderRanking & { created?: boolean }) => void;
  /** Likes somebody's ranking, or takes the like back: at once, and back if the backend says no. */
  like: (uid: string) => void;
  /** A guest's press: they are asked to sign in beside that ranking. */
  askSignIn: (uid: string) => void;
  dismissTrouble: () => void;
}

const NOTHING_YET: RankingsState = {
  status: "idle",
  rankings: [],
  next: null,
  more: "idle",
  withdrawFailed: false,
  countChange: 0,
  likeTrouble: null,
  gone: [],
};

/** The readers' rankings worth a row: never the author's, which the page draws from the list. */
const othersOf = (rankings: readonly ReaderRanking[]): ReaderRanking[] =>
  readersOf(rankings).filter((ranking) => ranking.isAuthor !== true);

/**
 * The readers' placings of one list, the way the app keeps them beside the
 * list: read when somebody asks to see them, a page at a time, in the
 * backend's order; liked and unliked; this reader's own taken down on request.
 */
export function useRankings(listId: string, deps: RankingsDeps = defaultDeps): Rankings {
  const [state, setState] = useState<RankingsState>(NOTHING_YET);
  // Read at the moment of a press rather than closed over, as useFollow does.
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  });
  // The last press on each ranking's like: an answer to an earlier one says nothing now.
  const presses = useRef(new Map<string, number>());
  // The first page is on its way: a second ask before it lands (React's checks
  // run an effect twice, before any render could say so) reads nothing more.
  const reading = useRef(false);

  const read = useCallback(
    (after: string | null, done: () => void = () => undefined) => {
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
          return !othersOf(page.rankings).some(isNew) && moved !== null && left > 0
            ? from(moved, left - 1)
            : { ...page, nextCursor: moved };
        });
      const settle = (page: RankingsPage) => {
        done();
        setState((now) => {
          const known = new Set(now.rankings.map((ranking) => ranking.uid));
          // One row a reader, even when a page names somebody twice; in the
          // order the backend sent them, never sorted again here.
          const fresh: ReaderRanking[] = [];
          for (const ranking of othersOf(page.rankings)) {
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
      };
      const failed = () => {
        done();
        setState((now) =>
          after === null ? { ...now, status: "failed" } : { ...now, more: "failed" },
        );
      };
      from(after, PAGES_READ_ON).then(settle, (reason: unknown) => {
        // The cursor is one the backend no longer reads (409 CURSOR_GONE):
        // read again from the top, keeping the rows here, as the feeds do.
        if (errorOf(reason).kind === "cursorGone") {
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
    if (reading.current || (status !== "idle" && status !== "failed")) return;
    reading.current = true;
    read(null, () => {
      reading.current = false;
    });
  }, [read]);

  const more = useCallback(() => {
    const { next, more: paging } = current.current;
    if (next !== null && paging !== "loading") read(next);
  }, [read]);

  const withdraw = useCallback(() => {
    const at = current.current.rankings.findIndex((ranking) => ranking.mine);
    const mine = current.current.rankings[at];
    if (mine === undefined) return;
    setState((now) => ({
      ...now,
      rankings: now.rankings.filter((ranking) => ranking !== mine),
      withdrawFailed: false,
      countChange: now.countChange - 1,
    }));
    deps.withdraw(listId).catch(() =>
      setState((now) => {
        const rest = now.rankings.filter((ranking) => ranking.uid !== mine.uid);
        return {
          ...now,
          rankings: [...rest.slice(0, at), mine, ...rest.slice(at)],
          withdrawFailed: true,
          countChange: now.countChange + 1,
        };
      }),
    );
  }, [listId, deps]);

  // Not read yet, the sheet reads it with the rest when it opens.
  const put = useCallback(({ created, ...ranking }: ReaderRanking & { created?: boolean }) => {
    setState((now) => {
      const countChange = now.countChange + (created === true ? 1 : 0);
      if (now.status !== "ready") return { ...now, countChange };
      const at = now.rankings.findIndex(
        (one) => one.mine || (ranking.uid !== "" && one.uid === ranking.uid),
      );
      // A new one has a place only the backend knows: the next look reads them afresh.
      const was = now.rankings[at];
      if (was === undefined) return { ...NOTHING_YET, countChange };
      const rankings = [...now.rankings];
      rankings[at] = { ...ranking, uid: ranking.uid || was.uid, mine: true };
      return { ...now, rankings, withdrawFailed: false, countChange };
    });
  }, []);

  const like = useCallback(
    (uid: string) => {
      const target = current.current.rankings.find((ranking) => ranking.uid === uid);
      if (target === undefined || target.mine || target.isAuthor === true) return;
      if (current.current.gone.includes(uid)) return;
      const before = target.likedByMe === true;
      const press = (presses.current.get(uid) ?? 0) + 1;
      presses.current.set(uid, press);
      const liked = (to: boolean) => (now: RankingsState) => ({
        ...now,
        rankings: now.rankings.map((ranking) =>
          ranking.uid === uid ? { ...ranking, likedByMe: to } : ranking,
        ),
      });
      setState((now) => ({ ...liked(!before)(now), likeTrouble: null }));
      deps.like(listId, uid, !before).then(
        (answer) => {
          if (presses.current.get(uid) === press) setState(liked(answer.likedByMe));
        },
        (reason: unknown) => {
          if (presses.current.get(uid) !== press) return;
          const trouble = likeTroubleOf(uid, errorOf(reason));
          setState((now) => ({
            ...liked(before)(now),
            likeTrouble: trouble,
            gone: trouble?.kind === "gone" ? [...now.gone, uid] : now.gone,
          }));
        },
      );
    },
    [listId, deps],
  );

  const askSignIn = useCallback(
    (uid: string) => setState((now) => ({ ...now, likeTrouble: { uid, kind: "signIn" } })),
    [],
  );
  const dismissTrouble = useCallback(
    () => setState((now) => (now.likeTrouble === null ? now : { ...now, likeTrouble: null })),
    [],
  );

  return { state, open, more, withdraw, put, like, askSignIn, dismissTrouble };
}
