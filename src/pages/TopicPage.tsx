import { useState, type ReactNode } from "react";
import { PageTitle } from "../app/pageTitle";
import { Link, Navigate, useParams } from "react-router";
import { errorOf } from "../api/errors";
import { creditAsAttribution } from "../api/pictureAttribution";
import { topicCreditOf, type Topic } from "../api/sections";
import type { FeedSort, ListSummary } from "../api/types";
import { FollowButton } from "../features/community/FollowButton";
import { useReporting, type Report } from "../features/community/useReporting";
import { FeedGrid } from "../features/feed/FeedGrid";
import { AboutPicture } from "../features/tierboard/AboutPicture";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import {
  OTHER,
  sectionPath,
  topicNameOf,
  topicPath,
  type Section,
} from "../features/sections/model";
import { sectionsStore } from "../features/sections/useSections";
import { loadSection, report as sendReport } from "../lib/api";
import { useResource } from "../lib/useResource";
import { fill, strings } from "../strings";
import { BackLink } from "../ui/BackLink";
import { Icon } from "../ui/Icon";
import {
  HeadArt,
  SectionLoading,
  SectionRoute,
  SectionTrouble,
  SortRow,
  type SectionPageProps,
} from "./SectionPageParts";
import {
  topicDeps,
  useCollapsed,
  useFollowFlow,
  useSectionTopics,
  useSort,
  type TopicDeps,
} from "./SectionPageState";

interface TopicViewProps {
  section: Section;
  topicId: string;
  load: LoadFeed | undefined;
  topics: TopicDeps;
  report: Report;
}

/**
 * The topic among the section's, or this person's own waiting one; failing
 * both, asked about by its id. Its lists are asked for at once, alongside.
 */
function TopicView({ section, topicId, load, topics, report }: TopicViewProps) {
  const [sort, setSort] = useSort();
  const feed = useFeed({ category: section.id, topic: topicId, sort }, load);
  const { approved, waiting, settled } = useSectionTopics(section, topics);
  const listed =
    approved.find((one) => one.id === topicId) ?? waiting.find((one) => one.id === topicId);
  const page = (topic: Topic) => (
    <TopicContent
      section={section}
      topic={topic}
      feed={feed}
      sort={sort}
      onSort={setSort}
      topics={topics}
      report={report}
    />
  );
  if (listed !== undefined) return page(listed);
  if (!settled) return <SectionLoading />;
  return <UnlistedTopic section={section} topicId={topicId} topics={topics} render={page} />;
}

interface TopicContentProps {
  section: Section;
  topic: Topic;
  feed: ReturnType<typeof useFeed>;
  sort: FeedSort;
  onSort: (sort: FeedSort) => void;
  topics: TopicDeps;
  report: Report;
}

/**
 * A topic's own page (the app's PR #208): its picture or its section's art,
 * its name under its section's, its Follow, and its lists. The proposer's
 * waiting one says so instead of offering a follow, which the backend takes
 * only for an approved topic. Each card offers "Not this topic", Hide and
 * Report, as the app's long press on a topic's list does.
 */
function TopicContent({ section, topic, feed, sort, onSort, topics, report }: TopicContentProps) {
  const collapsed = useCollapsed();
  const { toggle, failed, notify, overlays } = useFollowFlow();
  const reporting = useReporting({ report, notify });
  // A word to the moderators, the app's TopicViewModel.notThisTopic: nothing
  // on screen changes, so it is said at once; a refusal says so after, on the
  // site when the reader has left the page meanwhile.
  const notThisTopic = (list: ListSummary) => {
    notify({ text: strings.sections.notThisTopicSent });
    report(list.id, { reason: "wrong_category", note: null }).catch(() =>
      reporting.tell({ text: strings.report.failed }),
    );
  };
  // A follow made here shows at once; the backend's answer only corrects it.
  const [followed, setFollowed] = useState<boolean | null>(null);
  const following = followed ?? topic.following;
  const waiting = topic.status === "pending";
  const name = topicNameOf(topic);
  const credit = topicCreditOf(topic);
  const [about, setAbout] = useState(false);

  const follow = (next: boolean) => {
    setFollowed(next);
    return (next ? topics.follow(topic.id) : topics.unfollow(topic.id)).catch((reason: unknown) => {
      setFollowed(!next);
      failed(errorOf(reason), next);
    });
  };
  const button = (compact: boolean) =>
    waiting ? null : (
      <FollowButton
        following={following}
        size={compact ? "card" : "profile"}
        onClick={() => toggle(name, following, follow)}
      />
    );

  return (
    <section className="section-page">
      <header className="section-head">
        <HeadArt section={section} topic={topic} />
        <BackLink className="section-head__back" to={sectionPath(section.id)} />
        {credit !== null && (
          <button
            type="button"
            className="section-head__about"
            aria-label={strings.link.about}
            onClick={() => setAbout(true)}
          >
            <Icon name="info" />
          </button>
        )}
        <div className="section-head__text">
          <span className="section-head__over">
            <Icon name={section.icon} />
            {section.name}
          </span>
          <PageTitle title={name} inBar={false} />
          <h1 className="section-head__name">{name}</h1>
          {waiting ? (
            <span className="section-head__pill">
              <Icon name="schedule" />
              {strings.sections.waiting}
            </span>
          ) : (
            button(false)
          )}
        </div>
      </header>
      {collapsed && (
        <div className="section-bar">
          <span className="section-bar__name">{name}</span>
          {button(true)}
        </div>
      )}

      <SortRow sort={sort} onSort={onSort} />

      <FeedGrid
        state={feed.state}
        label={name}
        retry={feed.retry}
        more={feed.more}
        onWrongTopic={notThisTopic}
        onReport={reporting.start}
      />

      {about && credit !== null && (
        <AboutPicture
          name={name}
          attribution={creditAsAttribution(credit)}
          onClose={() => setAbout(false)}
        />
      )}
      {reporting.dialog}
      {overlays}
    </section>
  );
}

/**
 * A topic neither among the section's biggest fifty nor this person's own,
 * asked about by its id once. One filed under another section leads there,
 * one merged leads to the topic it went into; nothing by that id, or one
 * declined or still waiting for somebody else, is not here.
 */
function UnlistedTopic({
  section,
  topicId,
  topics,
  render,
}: {
  section: Section;
  topicId: string;
  topics: TopicDeps;
  render: (topic: Topic) => ReactNode;
}) {
  const { state, retry } = useResource(topicId, topics.one);
  if (state.status === "loading") return <SectionLoading />;
  if (state.status === "error") {
    const { kind } = state.error;
    if (kind === "notFound" || kind === "invalid") return <TopicMissing section={section} />;
    return <SectionTrouble offline={kind === "offline"} retry={retry} />;
  }
  const topic = state.value;
  const home = topic.section ?? OTHER;
  if (topic.status === "merged" && topic.mergedInto !== null) {
    return <Navigate to={topicPath(home, topic.mergedInto)} replace />;
  }
  if (topic.status !== "approved") return <TopicMissing section={section} />;
  if (home !== section.id) return <Navigate to={topicPath(home, topic.id)} replace />;
  return render(topic);
}

/** No such topic here: said in a line, with the way to the section it was looked for in. */
function TopicMissing({ section }: { section: Section }) {
  return (
    <section className="section-page">
      <div className="feed__trouble">
        <p>{fill(strings.sections.topicMissing, { section: section.name })}</p>
        <Link className="btn btn--tonal" to={sectionPath(section.id)}>
          <span>{fill(strings.sections.backToSection, { section: section.name })}</span>
        </Link>
      </div>
    </section>
  );
}

/** /s/:id/t/:topic: one topic of a section, on a page of its own. */
export function TopicPage({
  load,
  store = sectionsStore,
  topics = topicDeps,
  loadOne = loadSection,
  report = sendReport,
}: SectionPageProps) {
  const { id = "", topic = "" } = useParams();
  return (
    <SectionRoute id={id} store={store} loadOne={loadOne}>
      {(section) => (
        <TopicView
          key={topic}
          section={section}
          topicId={topic}
          load={load}
          topics={topics}
          report={report}
        />
      )}
    </SectionRoute>
  );
}
