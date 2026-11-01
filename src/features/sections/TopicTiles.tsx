import { Link } from "react-router";
import type { Topic } from "../../api/sections";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import {
  builtInSection,
  OTHER,
  sectionStyle,
  servedPicture,
  topicPath,
  topicPicture,
  type Section,
} from "./model";
import "./topics.css";

interface TopicTilesProps {
  section: Section;
  /** The approved ones, in the order they are drawn. */
  approved: readonly Topic[];
  /** This person's own still waiting, drawn after the rest. */
  waiting: readonly Topic[];
  onOpenWaiting: (topic: Topic) => void;
}

/**
 * A section's topics as tiles, the way Home draws sections (the app's
 * TopicTiles): the topic's own picture, or the section's art until it has
 * one, under its name. This person's waiting ones come last, dimmed, and open
 * what is known about them in place instead of a page.
 */
export function TopicTiles({ section, approved, waiting, onOpenWaiting }: TopicTilesProps) {
  return (
    <nav className="topic-tiles" aria-label={strings.sections.topics}>
      {approved.map((topic) => (
        <TopicTile key={topic.id} section={section} topic={topic} />
      ))}
      {waiting.map((topic) => (
        <TopicTile
          key={topic.id}
          section={section}
          topic={topic}
          onOpen={() => onOpenWaiting(topic)}
        />
      ))}
    </nav>
  );
}

/**
 * Topics a search found, from any section (the app's FoundTopicTiles): each
 * over its own section's art, the way a section's page draws its own.
 */
export function FoundTopicTiles({
  topics,
  sections,
}: {
  topics: readonly Topic[];
  sections: readonly Section[];
}) {
  const sectionOf = (topic: Topic): Section => {
    const id = topic.section ?? OTHER;
    // One the sections do not hold yet still leads to its own page, in Other's colours.
    return sections.find((one) => one.id === id) ?? { ...builtInSection(OTHER), id };
  };
  return (
    <nav className="topic-tiles" aria-label={strings.sections.topics}>
      {topics.map((topic) => (
        <TopicTile key={topic.id} section={sectionOf(topic)} topic={topic} />
      ))}
    </nav>
  );
}

function TopicTile({
  section,
  topic,
  onOpen,
}: {
  section: Section;
  topic: Topic;
  onOpen?: () => void;
}) {
  const picture = topicPicture(topic);
  const className = [
    "topic-tile",
    section.picture === null ? "" : "topic-tile--pictured",
    onOpen === undefined ? "" : "topic-tile--waiting",
  ]
    .filter(Boolean)
    .join(" ");
  const inside = (
    <>
      {picture !== null && (
        <img
          className="topic-tile__picture"
          src={servedPicture(picture)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      {onOpen !== undefined && (
        <span className="topic-tile__pill" aria-hidden="true">
          <Icon name="schedule" />
          {strings.sections.waiting}
        </span>
      )}
      <span className="topic-tile__name">{topic.name}</span>
    </>
  );
  return onOpen === undefined ? (
    <Link className={className} to={topicPath(section.id, topic.id)} style={sectionStyle(section)}>
      {inside}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      style={sectionStyle(section)}
      aria-label={fill(strings.sections.topicWaiting, { name: topic.name })}
      onClick={onOpen}
    >
      {inside}
    </button>
  );
}
