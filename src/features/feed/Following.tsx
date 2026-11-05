import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { Following, SuggestedAuthor } from "../../api/community";
import type { FeedQuery, ListSummary } from "../../api/types";
import { followAuthor, loadFollowing, suggestedAuthors, unfollowAuthor } from "../../lib/api";
import { isEditorialAuthor } from "../../lib/editorial";
import { useResource } from "../../lib/useResource";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { FollowButton } from "../community/FollowButton";
import { FollowingStrip } from "../sections/FollowingStrip";
import { FollowSections } from "../sections/FollowSections";
import { ProposalNotices } from "../sections/ProposalNotices";
import {
  followedOf,
  followedSectionIds,
  followedSectionOf,
  NOTHING_FOLLOWED,
  reasonFor,
} from "../sections/following";
import { OTHER, approvedOnly, builtInSection, sectionName, type Section } from "../sections/model";
import {
  heldSection,
  useSections,
  type SectionsStore,
  sectionsStore,
} from "../sections/useSections";
import { FeedGrid } from "./FeedGrid";
import { useFeed, type LoadFeed } from "./useFeed";
import "./following.css";

export type LoadSuggestions = () => Promise<{ authors: SuggestedAuthor[] }>;
export type Follow = (authorUid: string) => Promise<unknown>;

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

/** A person's picture, or their initial in a circle when they have none. */
function Face({
  author,
  className = "suggestion__face",
}: {
  author: { name: string; photoUrl: string | null };
  className?: string;
}) {
  return author.photoUrl !== null ? (
    <img className={className} src={author.photoUrl} alt="" loading="lazy" />
  ) : (
    <span className={`${className} suggestion__face--initial`} aria-hidden="true">
      {author.name.trim() === "" ? <Icon name="person" /> : initialOf(author.name)}
    </span>
  );
}

function SuggestionCard({
  author,
  follow,
  unfollow,
  onFollowed,
}: {
  author: SuggestedAuthor;
  follow: Follow;
  unfollow: Follow;
  onFollowed?: () => void;
}) {
  const [state, setState] = useState<"idle" | "following" | "failed">("idle");
  const toggle = () => {
    if (state === "following") {
      setState("idle");
      unfollow(author.uid).catch(() => setState("following"));
    } else {
      setState("following");
      follow(author.uid).then(onFollowed, () => setState("failed"));
    }
  };
  return (
    <li className="suggestion">
      <Link
        className="suggestion__who"
        to={`/u/${encodeURIComponent(author.uid)}`}
        state={{ author: { name: author.name, photoUrl: author.photoUrl } }}
      >
        <Face author={author} />
        <span className="suggestion__name">{author.name.trim() || strings.profile.someone}</span>
      </Link>
      <FollowButton following={state === "following"} onClick={toggle} size="card" />
      {state === "failed" && (
        <p className="follow__failed" role="alert">
          <Icon name="cloud_off" />
          {strings.follow.failed}
        </p>
      )}
    </li>
  );
}

/** Authors worth following, when the person follows nobody yet. */
export function Suggestions({
  uid,
  load = suggestedAuthors,
  follow = followAuthor,
  unfollow = unfollowAuthor,
  onFollowed,
}: {
  uid: string;
  load?: LoadSuggestions;
  follow?: Follow;
  unfollow?: Follow;
  /** Somebody was followed: the tab becomes their feed, as after following a section. */
  onFollowed?: () => void;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  // An editorial account is nobody to follow: its lists stand without an author.
  const authors =
    state.status === "ready"
      ? state.value.authors.filter((author) => !isEditorialAuthor(author.uid))
      : [];
  if (authors.length === 0) return null;
  return (
    <section className="suggestions" aria-labelledby="suggestions-title">
      <h3 id="suggestions-title" className="suggestions__title">
        {strings.home.worthFollowing}
      </h3>
      <ul className="suggestions__grid">
        {authors.map((author) => (
          <SuggestionCard
            key={author.uid}
            author={author}
            follow={follow}
            unfollow={unfollow}
            onFollowed={onFollowed}
          />
        ))}
      </ul>
    </section>
  );
}

export type LoadFollowing = () => Promise<Following>;

const FOLLOWING_FEED: FeedQuery = { following: true, sort: "recent" };

interface FollowingTabProps {
  uid: string;
  load?: LoadFeed;
  loadFollowing?: LoadFollowing;
  loadSuggestions?: LoadSuggestions;
  follow?: Follow;
  unfollow?: Follow;
  store?: SectionsStore;
}

/**
 * The Following tab, as the app has it: what the person follows in a strip,
 * then the lists those bring, newest first, each saying why it is there. With
 * nothing followed yet, the sections to follow, and people worth following.
 */
export function FollowingTab({
  uid,
  load,
  loadFollowing: loadFollowed = loadFollowing,
  loadSuggestions,
  follow,
  unfollow,
  store = sectionsStore,
}: FollowingTabProps) {
  const feed = useFeed(FOLLOWING_FEED, load);
  const snapshot = useSections(store);
  const { sections } = snapshot;
  // What is followed is read again whenever the feed is: a follow made from
  // the empty state's tiles changes both.
  const [round, setRound] = useState(0);
  const loadFor = useCallback(() => loadFollowed(), [loadFollowed]);
  const followed = useResource(`${uid}:${round}`, loadFor);
  const following = followed.state.status === "ready" ? followed.state.value : null;

  const byId = useMemo(() => new Map(sections.map((one) => [one.id, one])), [sections]);
  const sectionOf = useCallback(
    (id: string | null): Section => byId.get(id ?? OTHER) ?? builtInSection(OTHER),
    [byId],
  );
  const followedIds = useMemo(
    () => followedSectionIds(snapshot, following?.sections.map((one) => one.id) ?? null),
    [snapshot, following],
  );
  // A followed section the sections leave out is asked about, to be drawn by its name.
  useEffect(() => followedIds.forEach((id) => store.lookUp(id)), [followedIds, store]);
  const sets = useMemo(() => {
    const known = following === null ? NOTHING_FOLLOWED : followedOf(following);
    return { ...known, sections: new Set(followedIds) };
  }, [following, followedIds]);
  const nameOf = useCallback(
    (id: string) => heldSection(snapshot, id)?.name ?? sectionName(id, snapshot.sections),
    [snapshot],
  );
  const reasonOf = useCallback(
    (list: ListSummary) => reasonFor(list, sets, nameOf),
    [sets, nameOf],
  );

  // The empty tab's sections are picked first, then followed together, as in
  // the app: following each on its tap turned the tab into the feed at once.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [followingPicked, setFollowingPicked] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const strip = useRef<HTMLElement>(null);
  const landing = useRef(false);
  const togglePick = (section: Section) => {
    if (followingPicked) return;
    setPicked((before) => {
      const next = new Set(before);
      if (!next.delete(section.id)) next.add(section.id);
      return next;
    });
  };
  const showFollowed = () => {
    landing.current = true;
    setRound((n) => n + 1);
    feed.retry();
  };
  const followPicked = () => {
    const chosen = [...picked];
    if (chosen.length === 0 || followingPicked) return;
    setFollowingPicked(true);
    setPickFailed(false);
    void Promise.all(
      chosen.map((id) =>
        store.setFollowing(id, true).then((refused) => (refused === null ? id : null)),
      ),
    ).then((answers) => {
      const done = answers.filter((id): id is string => id !== null);
      // A refused one stays picked, and says so.
      setPicked(new Set(chosen.filter((id) => !done.includes(id))));
      setFollowingPicked(false);
      setPickFailed(done.length < chosen.length);
      if (done.length > 0) showFollowed();
    });
  };
  // The tiles go once something is followed: the focus goes to what is
  // followed now, not to the page.
  useEffect(() => {
    if (!landing.current || strip.current === null) return;
    strip.current.querySelector<HTMLElement>("a")?.focus();
    landing.current = false;
  });

  if (feed.state.status === "error") {
    return (
      <div className="feed__trouble" role="alert">
        <p>{strings.home.followingFailed}</p>
        <Button variant="tonal" icon="refresh" onClick={feed.retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }

  const nobody =
    followingPicked ||
    (feed.state.status === "ready" && feed.state.followingNobody && sets.sections.size === 0);
  if (nobody) {
    return (
      <>
        <div className="following-empty">
          <p className="following-empty__title">{strings.sections.emptyTitle}</p>
          <p className="following-empty__body">{strings.sections.emptyBody}</p>
        </div>
        {/* Only what anybody may follow: one's own waiting section is not yet. */}
        <FollowSections sections={approvedOnly(sections)} picked={picked} onToggle={togglePick} />
        <p className="following-empty__helper">{strings.sections.emptyHelper}</p>
        <div className="pick-bar">
          {pickFailed && (
            <p className="follow__failed" role="alert">
              <Icon name="cloud_off" />
              {strings.sections.followFailed}
            </p>
          )}
          <Button
            variant="filled"
            onClick={followPicked}
            disabled={picked.size === 0 || followingPicked}
          >
            {picked.size > 0
              ? fill(strings.sections.pickFollow, { n: picked.size })
              : strings.sections.pickNone}
          </Button>
        </div>
        <Suggestions
          uid={uid}
          load={loadSuggestions}
          follow={follow}
          unfollow={unfollow}
          onFollowed={showFollowed}
        />
      </>
    );
  }

  // What one follows, and one's own sections still waiting for a moderator.
  const stripSections = [
    ...followedIds.map((id) => followedSectionOf(snapshot, id)),
    ...sections.filter((one) => one.status === "pending" && !followedIds.includes(one.id)),
  ];
  // Whom one follows could not be read: the sections the site knows stay, and
  // so does the way to Manage, with another try.
  const followedFailed = followed.state.status === "error";
  const stripPart = (
    <>
      <ProposalNotices notices={snapshot.notices} nameOf={nameOf} onDismiss={store.dismissNotice} />
      {(following !== null || followedFailed) && (
        <FollowingStrip
          ref={strip}
          sections={stripSections}
          topics={following?.topics ?? []}
          people={(following?.authors ?? []).filter((person) => !isEditorialAuthor(person.uid))}
          sectionOf={sectionOf}
        />
      )}
      {followedFailed && (
        <div className="following-failed" role="alert">
          <p>{strings.sections.followedFailed}</p>
          <Button onClick={() => setRound((n) => n + 1)}>{strings.feed.tryAgain}</Button>
        </div>
      )}
    </>
  );
  if (feed.state.status === "ready" && feed.state.lists.length === 0) {
    return (
      <>
        {stripPart}
        <div className="following-empty">
          <p className="following-empty__body">{strings.sections.nothingPublished}</p>
          <Link className="btn btn--tonal" to="/">
            <span>{strings.sections.goExplore}</span>
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      {stripPart}
      <FeedGrid
        state={feed.state}
        label={strings.sections.tabFollowing}
        retry={feed.retry}
        more={feed.more}
        reasonOf={reasonOf}
      />
    </>
  );
}
