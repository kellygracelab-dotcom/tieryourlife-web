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
  failed: boolean;
  /** The one answer a guest gets: sign in first. */
  toggle: () => "signIn" | "done";
  /** Follows without asking, for right after a sign-in. */
  followNow: () => void;
}

/**
 * Following one author, the optimistic way: the button and the count change
 * on press and come back if the backend says no. A guest is told to sign in.
 */
export function useFollow(authorUid: string, deps: FollowDeps = defaultDeps): FollowControls {
  const { account } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (account === null) return;
    let current = true;
    deps.state(authorUid).then(
      (state) => {
        if (!current) return;
        setFollowing(signedIn ? state.following : false);
        setFollowers(state.followers);
      },
      () => {
        if (!current) return;
        setFollowing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [authorUid, account, signedIn, deps]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const change = useCallback(
    (next: boolean) => {
      const before = { following, followers };
      setFollowing(next);
      setFollowers((n) => (n === null ? null : Math.max(0, n + (next ? 1 : -1))));
      setFailed(false);
      (next ? deps.follow(authorUid) : deps.unfollow(authorUid)).catch(() => {
        setFollowing(before.following);
        setFollowers(before.followers);
        setFailed(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFailed(false), FOLLOW_FAILED_MS);
      });
    },
    [authorUid, deps, following, followers],
  );

  const toggle = useCallback((): "signIn" | "done" => {
    if (!signedIn) return "signIn";
    change(!(following ?? false));
    return "done";
  }, [signedIn, following, change]);

  const followNow = useCallback(() => change(true), [change]);

  return { following, followers, failed, toggle, followNow };
}
