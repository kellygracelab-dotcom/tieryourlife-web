import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Following, SuggestedAuthor } from "../../api/community";
import type { FeedQuery, ListSummary } from "../../api/types";
import { followAuthor, loadFollowing, suggestedAuthors, unfollowAuthor } from "../../lib/api";
import { isEditorialAuthor } from "../../lib/editorial";
import { useResource } from "../../lib/useResource";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { FollowButton } from "../community/FollowButton";
import { FollowingStrip } from "../sections/FollowingStrip";
import { FollowSections } from "../sections/FollowSections";
import { followedOf, NOTHING_FOLLOWED, reasonFor } from "../sections/following";
import { OTHER, builtInSection, type Section } from "../sections/model";
import { useSections, type SectionsStore, sectionsStore } from "../sections/useSections";
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
      {initialOf(author.name)}
    </span>
  );
}

function SuggestionCard({
  author,
  follow,
  unfollow,
}: {
  author: SuggestedAuthor;
  follow: Follow;
  unfollow: Follow;
}) {
  const [state, setState] = useState<"idle" | "following" | "failed">("idle");
  const toggle = () => {
    if (state === "following") {
      setState("idle");
      unfollow(author.uid).catch(() => setState("following"));
    } else {
      setState("following");
      follow(author.uid).catch(() => setState("failed"));
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
        <span className="suggestion__meta">{plural(strings.card.rankings, author.takeCount)}</span>
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
}: {
  uid: string;
  load?: LoadSuggestions;
  follow?: Follow;
  unfollow?: Follow;
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
          <SuggestionCard key={author.uid} author={author} follow={follow} unfollow={unfollow} />
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
  const { sections } = useSections(store);
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
  const sets = useMemo(() => {
    const known = following === null ? NOTHING_FOLLOWED : followedOf(following);
    // The sections the site knows to be followed are the freshest word.
    const followedSections = new Set(sections.filter((one) => one.following).map((one) => one.id));
    return { ...known, sections: followedSections };
  }, [following, sections]);
  const reasonOf = useCallback(
    (list: ListSummary) => reasonFor(list, sets, (id) => sectionOf(id).name),
    [sets, sectionOf],
  );

  const toggleSection = (section: Section) => {
    void store.setFollowing(section.id, !section.following).then(() => {
      setRound((n) => n + 1);
      feed.retry();
    });
  };

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
    feed.state.status === "ready" && feed.state.followingNobody && sets.sections.size === 0;
  if (nobody) {
    return (
      <>
        <div className="following-empty">
          <p className="following-empty__title">{strings.sections.emptyTitle}</p>
          <p className="following-empty__body">{strings.sections.emptyBody}</p>
        </div>
        <FollowSections sections={sections} onToggle={toggleSection} />
        <p className="following-empty__helper">{strings.sections.emptyHelper}</p>
        <Suggestions uid={uid} load={loadSuggestions} follow={follow} unfollow={unfollow} />
      </>
    );
  }

  const strip = following !== null && (
    <FollowingStrip
      sections={sections.filter((one) => one.following)}
      topics={following.topics}
      people={following.authors.filter((person) => !isEditorialAuthor(person.uid))}
      sectionOf={sectionOf}
    />
  );
  if (feed.state.status === "ready" && feed.state.lists.length === 0) {
    return (
      <>
        {strip}
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
      {strip}
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
