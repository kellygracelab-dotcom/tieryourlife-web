import { useCallback, useEffect, useRef, useState } from "react";
import type { FollowState } from "../../api/community";
import { useSession } from "../../app/session";
import { followAuthor, followState, unfollowAuthor } from "../../lib/api";

export interface FollowDeps {
  state: (authorUid: string) => Promise<FollowState>;
  follow: (authorUid: string) => Promise<unknown>;
  unfollow: (authorUid: string) => Promise<unknown>;
}

const defaultDeps: FollowDeps = {
  state: followState,
  follow: followAuthor,
  unfollow: unfollowAuthor,
};

/** The failure line stays this long. */
export const FOLLOW_FAILED_MS = 6000;

export interface FollowControls {
  /** null until the backend has said. */
  following: boolean | null;
  followers: number | null;
  /** Which way the last press was refused, said for a while. */
  failed: "follow" | "unfollow" | null;
  /** The one answer a guest gets: sign in first. */
  toggle: () => "signIn" | "done";
  /** Follows without asking: right after a sign-in, or to undo an unfollow. */
  followNow: () => void;
}

export interface FollowOptions {
  /**
   * Whether the page shows how many follow. Without the count a guest's
   * answer is known without asking, and asking would sign a mere visitor in
   * as a guest.
   */
  counted?: boolean;
}

/**
 * Following one author, the optimistic way: the button and the count change
 * on press and come back if the backend says no. A guest is told to sign in.
 */
export function useFollow(
  authorUid: string,
  deps: FollowDeps = defaultDeps,
  { counted = true }: FollowOptions = {},
): FollowControls {
  const { account } = useSession();
  const signedIn = account?.kind === "signedIn";
  // A guest follows nobody; without a count to show, there is nothing to ask.
  const unasked = account !== null && !signedIn && !counted;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [failed, setFailed] = useState<"follow" | "unfollow" | null>(null);
  // Presses so far: an answer to a question asked before the last of them
  // no longer says what is followed, only how many follow.
  const presses = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the page shows at the moment of a press: the place to come back to
  // if the backend says no. Read at the press rather than closed over, so an
  // Undo kept in a snackbar undoes the unfollow, not the state before it.
  const shown = useRef({ following, followers });
  useEffect(() => {
    shown.current = { following, followers };
  });

  useEffect(() => {
    if (account === null || unasked) return;
    let current = true;
    const asked = presses.current;
    deps.state(authorUid).then(
      (state) => {
        if (!current) return;
        if (presses.current === asked) setFollowing(signedIn ? state.following : false);
        setFollowers(state.followers);
      },
      () => {
        // A member's answer stays unknown, so no Follow is offered to somebody
        // who may follow already; a guest follows nobody.
        if (current && !signedIn && presses.current === asked) setFollowing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [authorUid, account, signedIn, unasked, deps]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const change = useCallback(
    (next: boolean) => {
      const before = shown.current;
      presses.current += 1;
      setFollowing(next);
      setFollowers((n) => (n === null ? null : Math.max(0, n + (next ? 1 : -1))));
      setFailed(null);
      (next ? deps.follow(authorUid) : deps.unfollow(authorUid)).catch(() => {
        setFollowing(before.following);
        setFollowers(before.followers);
        setFailed(next ? "follow" : "unfollow");
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFailed(null), FOLLOW_FAILED_MS);
      });
    },
    [authorUid, deps],
  );

  const toggle = useCallback((): "signIn" | "done" => {
    if (!signedIn) return "signIn";
    change(!(shown.current.following ?? false));
    return "done";
  }, [signedIn, change]);

  const followNow = useCallback(() => change(true), [change]);

  return { following: unasked ? false : following, followers, failed, toggle, followNow };
}
