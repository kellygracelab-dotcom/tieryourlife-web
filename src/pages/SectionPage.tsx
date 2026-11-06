import { useState } from "react";
import { PageTitle } from "../app/pageTitle";
import { Navigate, useNavigate, useParams } from "react-router";
import { useSession } from "../app/session";
import type { Topic } from "../api/sections";
import { isCategory } from "../api/types";
import { FollowButton } from "../features/community/FollowButton";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import {
  builtInSection,
  sectionPath,
  topicPath,
  waitingPath,
  type Section,
} from "../features/sections/model";
import { TopicTiles } from "../features/sections/TopicTiles";
import { SuggestTopicDialog } from "../features/sections/SuggestTopicDialog";
import {
  heldSection,
  sectionsStore,
  useSections,
  type SectionsStore,
} from "../features/sections/useSections";
import { WaitingSheet } from "../features/sections/WaitingSheet";
import { loadSection } from "../lib/api";
import { fill, strings } from "../strings";
import { BackLink } from "../ui/BackLink";
import { Icon } from "../ui/Icon";
import { sayOnTheSite } from "../ui/siteNotice";
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
  const [suggesting, setSuggesting] = useState(false);

  const navigate = useNavigate();
  const followSection = (following: boolean) =>
    store.setFollowing(section.id, following).then((refused) => {
      if (refused === null) return;
      // Merged while the page was open: its follows and its address are the
      // other section's now, so the page goes there, as a reload would take it.
      if (refused.kind === "merged" && refused.into !== null) {
        const into = refused.into;
        store.invalidate();
        const to = refused.topic === null ? sectionPath(into) : topicPath(into, refused.topic);
        void navigate(to, { replace: true });
        carryOver(into, following);
        return;
      }
      failed(refused, following);
    });
  // The press is not lost: it goes to the section this one went into, as the
  // app's follow of a merged id does (the backend moved this one's followers
  // there, so an Unfollow leaves that one), and the site says so, since this
  // page has given way to that one's.
  const carryOver = (into: string, following: boolean) => {
    const target =
      heldSection(store.get(), into) ?? (isCategory(into) ? builtInSection(into) : null);
    const words = { name: section.name, section: target?.name ?? into };
    void store.setFollowing(into, following).then((again) => {
      if (again !== null) {
        sayOnTheSite({ text: fill(strings.sections.mergedTryAgain, words) });
      } else if (following) {
        sayOnTheSite({ text: fill(strings.sections.mergedFollowed, words) });
      } else {
        sayOnTheSite({
          text: fill(strings.sections.mergedUnfollowed, words),
          action: {
            text: strings.sections.undo,
            onClick: () => void store.setFollowing(into, true),
          },
        });
      }
    });
  };
  // Unknown until the backend has said whom this person follows: the nine
  // standing in before then say nobody does.
  const { account } = useSession();
  const snapshot = useSections(store);
  const known =
    account?.kind === "guest" ||
    snapshot.followsKnown ||
    snapshot.extra.some((one) => one.id === section.id);
  const sectionButton = (compact: boolean) => (
    <FollowButton
      following={known ? section.following : null}
      size={compact ? "card" : "profile"}
      onClick={() => toggle(section.name, section.following, followSection)}
    />
  );
  // Says where topics come from first: a press alone makes no list.
  const suggest = (
    <button
      type="button"
      className="btn btn--text section-topics__suggest"
      aria-haspopup="dialog"
      onClick={() => setSuggesting(true)}
    >
      <Icon name="add" className="btn__icon" />
      <span>{strings.sections.suggestTopic}</span>
    </button>
  );
  const anyTopics = approved.length > 0 || waiting.length > 0;
  // One wait for the topics and the first page together, then everything at
  // once: nothing below the sort moves when one of them comes in late.
  const ready = settled && feed.state.status !== "loading";

  return (
    <section className="section-page">
      <header className="section-head">
        <HeadArt section={section} />
        <BackLink className="section-head__back" to="/" />
        <div className="section-head__text">
          <PageTitle title={section.name} inBar={false} />
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
          topic
          note={strings.sections.waitingOnlyYou}
          onClose={() => setOpened(null)}
        />
      )}
      {suggesting && <SuggestTopicDialog section={section} onClose={() => setSuggesting(false)} />}
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
      {(section) =>
        // One's own waiting section has no lists and no followers yet: it
        // opens as its tile does, with the way to take it back.
        section.status === "pending" ? (
          <Navigate to={waitingPath(section.id)} replace />
        ) : (
          <SectionView section={section} load={load} store={store} topics={topics} />
        )
      }
    </SectionRoute>
  );
}

/** /c/:category, where sections were before they moved to the app's /s/. */
export function SectionRedirect() {
  const { category = "" } = useParams();
  return <Navigate to={sectionPath(category)} replace />;
}
