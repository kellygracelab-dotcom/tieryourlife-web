import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Topic } from "../api/sections";
import type { FeedSort } from "../api/types";
import { useSession } from "../app/session";
import { SignInDialog } from "../features/community/SignInDialog";
import { OTHER, type Section } from "../features/sections/model";
import {
  followTopic as followTopicNow,
  loadMyTopics as loadMine,
  loadTopic as loadOneTopic,
  loadTopics as loadSectionTopics,
  unfollowTopic as unfollowTopicNow,
} from "../lib/api";
import { useResource } from "../lib/useResource";
import { fill, strings } from "../strings";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";

/** How far the page scrolls before its header folds into a bar. */
export const COLLAPSE_AT = 136;

export interface TopicDeps {
  load: (section: string) => Promise<{ topics: Topic[] }>;
  mine: () => Promise<{ topics: Topic[] }>;
  /** One topic by its id, for one the section's biggest fifty leave out. */
  one: (id: string) => Promise<Topic>;
  follow: (id: string) => Promise<unknown>;
  unfollow: (id: string) => Promise<unknown>;
}

export const topicDeps: TopicDeps = {
  load: (section) => loadSectionTopics(section, 50),
  mine: loadMine,
  one: loadOneTopic,
  follow: followTopicNow,
  unfollow: unfollowTopicNow,
};

/** Whether the page has scrolled past its header, which then folds into a bar. */
export function useCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const follow = () => setCollapsed(window.scrollY > COLLAPSE_AT);
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    return () => window.removeEventListener("scroll", follow);
  }, []);
  return collapsed;
}

/** Popular or Newest, kept in the address so a reload or a shared link keeps it. */
export function useSort(): [FeedSort, (sort: FeedSort) => void] {
  const [params, setParams] = useSearchParams();
  const sort: FeedSort = params.get("sort") === "recent" ? "recent" : "popular";
  const choose = (next: FeedSort) => {
    const after = new URLSearchParams(params);
    if (next === "recent") after.set("sort", "recent");
    else after.delete("sort");
    setParams(after, { replace: true });
  };
  return [sort, choose];
}

export interface SectionTopics {
  /** The approved ones, the most followed first. */
  approved: Topic[];
  /** This person's own, still waiting for a moderator. */
  waiting: Topic[];
  /** Both have answered, either way: a topic in neither is not among them. */
  settled: boolean;
}

/** A section's approved topics, and the ones this person proposed in it that still wait. */
export function useSectionTopics(section: Section, topics: TopicDeps): SectionTopics {
  const { account } = useSession();
  const signedIn = account?.kind === "signedIn";
  const loadTopics = useCallback(() => topics.load(section.id), [topics, section.id]);
  const listed = useResource(section.id, loadTopics);
  const loadMyTopics = useCallback(
    () => (signedIn ? topics.mine() : Promise.resolve({ topics: [] })),
    [topics, signedIn],
  );
  const mine = useResource(`${section.id}:${account?.uid ?? ""}`, loadMyTopics);

  const approved = (listed.state.status === "ready" ? listed.state.value.topics : [])
    .filter((one) => one.status === "approved")
    .sort((a, b) => b.followerCount - a.followerCount);
  const waiting =
    mine.state.status === "ready"
      ? mine.state.value.topics.filter(
          (one) => one.status === "pending" && (one.section ?? OTHER) === section.id,
        )
      : [];
  return {
    approved,
    waiting,
    settled: listed.state.status !== "loading" && mine.state.status !== "loading",
  };
}

type Asking = "closed" | "open" | "busy";

/**
 * Follow the page's way: at once, with Undo after an unfollow, and a guest
 * asked to sign in first, the follow made right after. What it draws, the
 * dialog and the snackbar, goes once at the end of the page.
 */
export function useFollowFlow() {
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [asking, setAsking] = useState<Asking>("closed");
  const [pendingFollow, setPendingFollow] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const closeAsk = useCallback(() => setAsking("closed"), []);

  const failed = () => setNotice({ text: strings.sections.followFailed });

  const toggle = (name: string, following: boolean, apply: (following: boolean) => void) => {
    if (!signedIn) {
      setPendingFollow(() => () => apply(true));
      setAsking("open");
      return;
    }
    apply(!following);
    if (following) {
      setNotice({
        text: fill(strings.sections.unfollowed, { name }),
        action: { text: strings.sections.undo, onClick: () => apply(true) },
      });
    }
  };

  const onSignIn = () => {
    setAsking("busy");
    void signIn().then((outcome) => {
      setAsking("closed");
      if (outcome.kind === "signedIn") pendingFollow?.();
      setPendingFollow(null);
    });
  };

  const overlays = (
    <>
      <SignInDialog
        open={asking !== "closed"}
        busy={asking === "busy"}
        title={strings.follow.signInTitle}
        body={strings.follow.signInBody}
        onSignIn={onSignIn}
        onCancel={closeAsk}
      />
      <Snackbar notice={notice} onDone={clearNotice} />
    </>
  );

  return { toggle, failed, overlays };
}
