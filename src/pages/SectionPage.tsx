import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import type { Topic } from "../api/sections";
import { FollowButton } from "../features/community/FollowButton";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import { sectionPath, type Section } from "../features/sections/model";
import { TopicTiles } from "../features/sections/TopicTiles";
import { sectionsStore, type SectionsStore } from "../features/sections/useSections";
import { WaitingSheet } from "../features/sections/WaitingSheet";
import { loadSection } from "../lib/api";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import { HeadArt, SectionRoute, SortRow, type SectionPageProps } from "./SectionPageParts";
import {
  topicDeps,
  useCollapsed,
  useFollowFlow,
  useSectionTopics,
  useSort,
  type TopicDeps,
} from "./SectionPageState";

interface SectionViewProps {
  section: Section;
  load: LoadFeed | undefined;
  store: SectionsStore;
  topics: TopicDeps;
}

function SectionView({ section, load, store, topics }: SectionViewProps) {
  const [sort, setSort] = useSort();
  const feed = useFeed({ category: section.id, sort }, load);
  const { approved, waiting, settled } = useSectionTopics(section, topics);
  const collapsed = useCollapsed();
  const { toggle, failed, overlays } = useFollowFlow();
  const [opened, setOpened] = useState<Topic | null>(null);

  const followSection = (following: boolean) => {
    void store.setFollowing(section.id, following).then((done) => {
      if (!done) failed();
    });
  };
  const sectionButton = (compact: boolean) => (
    <FollowButton
      following={section.following}
      size={compact ? "card" : "profile"}
      onClick={() => toggle(section.name, section.following, followSection)}
    />
  );
  const suggest = (
    <Link
      className="btn btn--text section-topics__suggest"
      to={`/b/new?category=${encodeURIComponent(section.id)}`}
    >
      <Icon name="add" className="btn__icon" />
      <span>{strings.sections.suggestTopic}</span>
    </Link>
  );
  const anyTopics = approved.length > 0 || waiting.length > 0;
  // One wait for the topics and the first page together, then everything at
  // once: nothing below the sort moves when one of them comes in late.
  const ready = settled && feed.state.status !== "loading";

  return (
    <section className="section-page">
      <header className="section-head">
        <HeadArt section={section} />
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

      {/* The sort sits right under the header and never moves. With no topic
          to show, the way to suggest one leads it instead of a title of its own. */}
      <SortRow sort={sort} onSort={setSort}>
        {ready && !anyTopics && suggest}
      </SortRow>

      {!ready && <Spinner className="section-page__loading" label={section.name} />}

      {ready && anyTopics && (
        <div className="section-topics">
          <div className="section-topics__head">
            <h2 className="section-topics__title">{strings.sections.topics}</h2>
            {suggest}
          </div>
          <TopicTiles
            section={section}
            approved={approved}
            waiting={waiting}
            onOpenWaiting={setOpened}
          />
        </div>
      )}

      {ready && (
        <FeedGrid state={feed.state} label={section.name} retry={feed.retry} more={feed.more} />
      )}

      {overlays}
      {opened !== null && (
        <WaitingSheet
          section={opened}
          filedIn={section.name}
          note={strings.sections.waitingOnlyYou}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

/**
 * One section, the app's way: its header with four covers and Follow, the
 * order of its lists, then its topics as tiles that open their own pages and
 * its lists by popularity or newest first.
 */
export function SectionPage({
  load,
  store = sectionsStore,
  topics = topicDeps,
  loadOne = loadSection,
}: SectionPageProps) {
  const { id = "" } = useParams();
  return (
    <SectionRoute id={id} store={store} loadOne={loadOne}>
      {(section) => <SectionView section={section} load={load} store={store} topics={topics} />}
    </SectionRoute>
  );
}

/** /c/:category, where sections were before they moved to the app's /s/. */
export function SectionRedirect() {
  const { category = "" } = useParams();
  return <Navigate to={sectionPath(category)} replace />;
}
