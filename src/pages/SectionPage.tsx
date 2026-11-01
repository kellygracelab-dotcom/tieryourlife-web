import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import type { SectionStats, Topic } from "../api/sections";
import { isCategory, type FeedSort } from "../api/types";
import { useSession } from "../app/session";
import { FollowButton } from "../features/community/FollowButton";
import { SignInDialog } from "../features/community/SignInDialog";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import {
  builtInSection,
  sectionOf,
  sectionPath,
  sectionStyle,
  topicPath,
  topicStyle,
  type Section,
} from "../features/sections/model";
import { TopicArt } from "../features/sections/TopicArt";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import {
  followTopic as followTopicNow,
  loadMyTopics as loadMine,
  loadSection,
  loadTopics as loadSectionTopics,
  unfollowTopic as unfollowTopicNow,
} from "../lib/api";
import { useResource } from "../lib/useResource";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { NotFoundPage } from "./NotFoundPage";
import "./SectionPage.css";

/** How far the page scrolls before its header folds into a bar. */
export const COLLAPSE_AT = 136;

export interface TopicDeps {
  load: (section: string) => Promise<{ topics: Topic[] }>;
  mine: () => Promise<{ topics: Topic[] }>;
  follow: (id: string) => Promise<unknown>;
  unfollow: (id: string) => Promise<unknown>;
}

const topicDeps: TopicDeps = {
  load: (section) => loadSectionTopics(section, 50),
  mine: loadMine,
  follow: followTopicNow,
  unfollow: unfollowTopicNow,
};

interface SectionPageProps {
  load?: LoadFeed;
  store?: SectionsStore;
  topics?: TopicDeps;
  /** One section by its id, for one the sections do not hold. */
  loadOne?: (id: string) => Promise<SectionStats>;
}

type Asking = "closed" | "open" | "busy";

/** The header: four covers when the section has them, its own art otherwise. */
function SectionHeader({ section }: { section: Section }) {
  return (
    <div
      className={
        section.collage.length > 0
          ? "section-head__art"
          : `section-head__art section-head__art--own${section.picture === null ? "" : " section-head__art--pictured"}`
      }
      style={sectionStyle(section, 1600)}
      aria-hidden="true"
    >
      {section.collage.map((url) => (
        <img key={url} src={url} alt="" />
      ))}
    </div>
  );
}

interface SectionViewProps {
  section: Section;
  load: LoadFeed | undefined;
  store: SectionsStore;
  topics: TopicDeps;
}

function SectionView({ section, load, store, topics }: SectionViewProps) {
  const { topic: topicId } = useParams();
  const [params, setParams] = useSearchParams();
  const sort: FeedSort = params.get("sort") === "recent" ? "recent" : "popular";
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const feed = useFeed(
    {
      category: section.id,
      ...(topicId === undefined ? {} : { topic: topicId }),
      sort,
    },
    load,
  );

  const loadTopics = useCallback(() => topics.load(section.id), [topics, section.id]);
  const listed = useResource(section.id, loadTopics);
  const loadMyTopics = useCallback(
    () => (signedIn ? topics.mine() : Promise.resolve({ topics: [] })),
    [topics, signedIn],
  );
  const mine = useResource(`${section.id}:${account?.uid ?? ""}`, loadMyTopics);
  // A follow made here shows at once; the backend's answer only corrects it.
  const [followedTopics, setFollowedTopics] = useState<ReadonlyMap<string, boolean>>(new Map());

  const approved = (listed.state.status === "ready" ? listed.state.value.topics : [])
    .filter((one) => one.status === "approved")
    .sort((a, b) => b.followerCount - a.followerCount);
  const waiting =
    mine.state.status === "ready"
      ? mine.state.value.topics.filter(
          (one) => one.status === "pending" && (one.section ?? "other") === section.id,
        )
      : [];
  const chosen = [...approved, ...waiting].find((one) => one.id === topicId) ?? null;
  const topicFollowing = (topic: Topic) => followedTopics.get(topic.id) ?? topic.following;

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const follow = () => setCollapsed(window.scrollY > COLLAPSE_AT);
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    return () => window.removeEventListener("scroll", follow);
  }, []);

  const [asking, setAsking] = useState<Asking>("closed");
  const [pendingFollow, setPendingFollow] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const failed = () => setNotice({ text: strings.sections.followFailed });

  const followSection = (following: boolean) => {
    void store.setFollowing(section.id, following).then((done) => {
      if (!done) failed();
    });
  };
  const followTopic = (topic: Topic, following: boolean) => {
    setFollowedTopics((before) => new Map(before).set(topic.id, following));
    (following ? topics.follow(topic.id) : topics.unfollow(topic.id)).catch(() => {
      setFollowedTopics((before) => new Map(before).set(topic.id, !following));
      failed();
    });
  };

  /** A guest is asked to sign in first; the follow is made right after. */
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
  const closeAsk = useCallback(() => setAsking("closed"), []);

  const sectionButton = (compact: boolean) => (
    <FollowButton
      following={section.following}
      size={compact ? "card" : "profile"}
      onClick={() =>
        toggle(section.name, section.following, (following) => followSection(following))
      }
    />
  );

  return (
    <section className="section-page">
      <header className="section-head">
        <SectionHeader section={section} />
        <Link className="section-head__back" to="/" aria-label={strings.sections.back}>
          <Icon name="arrow_back" />
        </Link>
        <div className="section-head__text">
          <h1 className="section-head__name">
            <Icon name={section.icon} className="section-head__icon" />
            {section.name}
          </h1>
          {sectionButton(false)}
        </div>
      </header>
      {collapsed && (
        <div className="section-bar">
          <span className="section-bar__name">{section.name}</span>
          {sectionButton(true)}
        </div>
      )}

      <nav className="section-topics" aria-label={strings.sections.topics}>
        <Link
          className={topicId === undefined ? "chip chip--selected" : "chip"}
          to={sectionPath(section.id)}
          aria-current={topicId === undefined ? "page" : undefined}
        >
          {strings.sections.allTopics}
        </Link>
        {approved.map((one) => (
          <Link
            key={one.id}
            className={topicId === one.id ? "chip chip--selected" : "chip"}
            to={topicPath(section.id, one.id)}
            aria-current={topicId === one.id ? "page" : undefined}
          >
            {one.name}
          </Link>
        ))}
        {waiting.map((one) => (
          <Link
            key={one.id}
            className="chip chip--waiting"
            to={topicPath(section.id, one.id)}
            aria-current={topicId === one.id ? "page" : undefined}
          >
            {fill(strings.sections.topicWaiting, { name: one.name })}
          </Link>
        ))}
        <Link className="chip chip--add" to={`/b/new?category=${encodeURIComponent(section.id)}`}>
          <Icon name="add" className="chip__icon" />
          {strings.sections.suggestTopic}
        </Link>
      </nav>

      {chosen !== null && (
        <div className="section-topic" style={topicStyle(section)}>
          <span className="section-topic__square" style={sectionStyle(section)} aria-hidden="true">
            <TopicArt topic={chosen} icon={section.icon} />
          </span>
          <div className="section-topic__text">
            <h2 className="section-topic__name">{chosen.name}</h2>
          </div>
          {chosen.status === "approved" && (
            <FollowButton
              following={topicFollowing(chosen)}
              size="card"
              onClick={() =>
                toggle(chosen.name, topicFollowing(chosen), (following) =>
                  followTopic(chosen, following),
                )
              }
            />
          )}
        </div>
      )}

      <div className="section-sort">
        <label className="section-sort__order">
          <select
            aria-label={strings.search.sortBy}
            value={sort}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value === "recent") next.set("sort", "recent");
              else next.delete("sort");
              setParams(next, { replace: true });
            }}
          >
            <option value="popular">{strings.sections.sortPopular}</option>
            <option value="recent">{strings.sections.sortNewest}</option>
          </select>
          <Icon name="expand_more" />
        </label>
      </div>

      <FeedGrid
        state={feed.state}
        label={chosen?.name ?? section.name}
        retry={feed.retry}
        more={feed.more}
      />

      <SignInDialog
        open={asking !== "closed"}
        busy={asking === "busy"}
        title={strings.follow.signInTitle}
        body={strings.follow.signInBody}
        onSignIn={onSignIn}
        onCancel={closeAsk}
      />
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}

/**
 * One section, the app's way: its header with four covers, follow, its topics
 * as chips, and its lists by popularity or newest first. /s/:id/t/:topic
 * narrows to one topic.
 */
export function SectionPage({
  load,
  store = sectionsStore,
  topics = topicDeps,
  loadOne = loadSection,
}: SectionPageProps) {
  const { id = "" } = useParams();
  const { sections, loaded, failed } = useSections(store);
  const known = sections.find((one) => one.id === id);
  const section = known ?? (isCategory(id) ? builtInSection(id) : null);
  if (section !== null) {
    return (
      <SectionView key={section.id} section={section} load={load} store={store} topics={topics} />
    );
  }
  // Not among the sections, which may not have answered yet: asked about on
  // its own only once they have.
  if (!loaded && !failed) return <SectionLoading />;
  return (
    <UnlistedSection key={id} id={id} loadOne={loadOne} load={load} store={store} topics={topics} />
  );
}

function SectionLoading() {
  return (
    <section className="section-page" aria-busy="true">
      <Skeleton height="200px" />
    </section>
  );
}

/**
 * A section no tile shows, asked about by its id once: hidden, approved since
 * the sections were read, or merged into another, whose address it leads to
 * now. Nothing by that id is Not found.
 */
function UnlistedSection({
  id,
  loadOne,
  ...view
}: Omit<SectionViewProps, "section"> & {
  id: string;
  loadOne: (id: string) => Promise<SectionStats>;
}) {
  const { state, retry } = useResource(id, loadOne);
  if (state.status === "loading") return <SectionLoading />;
  if (state.status === "ready") return <SectionView section={sectionOf(state.value)} {...view} />;
  const { error } = state;
  // A proposal approved as a topic leads to that topic, inside the section it went into.
  if (error.kind === "merged" && error.into !== null) {
    return (
      <Navigate
        to={error.topic === null ? sectionPath(error.into) : topicPath(error.into, error.topic)}
        replace
      />
    );
  }
  if (error.kind === "notFound" || error.kind === "merged") return <NotFoundPage />;
  return (
    <section className="section-page">
      <div className="feed__trouble" role="alert">
        <p>{error.kind === "offline" ? strings.feed.offline : strings.feed.failed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    </section>
  );
}

/** /c/:category, where sections were before they moved to the app's /s/. */
export function SectionRedirect() {
  const { category = "" } = useParams();
  return <Navigate to={sectionPath(category)} replace />;
}
