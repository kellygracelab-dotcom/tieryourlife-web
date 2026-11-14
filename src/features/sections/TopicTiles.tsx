import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MediaImage } from "../../ui/MediaImage";
import { Link } from "react-router";
import type { Topic } from "../../api/sections";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import {
  builtInSection,
  OTHER,
  sectionStyle,
  servedPicture,
  topicPath,
  topicNameOf,
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
  const grid = useRef<HTMLElement>(null);
  const columns = useColumns(grid);
  // Two rows while folded, whatever the columns (section layout, 14.11): the
  // lists stay near the top however many topics a section has.
  const [open, setOpen] = useState(false);
  const total = approved.length + waiting.length;
  const fold = columns * 2;
  const folds = total > fold;
  const shown = (index: number) => open || !folds || index < fold;
  return (
    <>
      <nav ref={grid} className="topic-tiles" aria-label={strings.sections.topics}>
        {approved.map((topic, index) => (
          <TopicTile key={topic.id} section={section} topic={topic} hidden={!shown(index)} />
        ))}
        {waiting.map((topic, index) => (
          <TopicTile
            key={topic.id}
            section={section}
            topic={topic}
            hidden={!shown(approved.length + index)}
            onOpen={() => onOpenWaiting(topic)}
          />
        ))}
      </nav>
      {folds && (
        <button
          type="button"
          className="btn btn--text topic-tiles__more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? strings.sections.showFewer : plural(strings.sections.showAllTopics, total)}
        </button>
      )}
    </>
  );
}

/** How many columns the grid draws at its width now: two before it is laid out. */
function useColumns(grid: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(2);
  useLayoutEffect(() => {
    const element = grid.current;
    if (element === null) return;
    const measure = () => {
      const tracks = getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean);
      setColumns(Math.max(2, tracks.length));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid]);
  return columns;
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
  hidden = false,
}: {
  section: Section;
  topic: Topic;
  onOpen?: () => void;
  /** Folded away under Show all. */
  hidden?: boolean;
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
        <MediaImage
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
      <span className="topic-tile__name">{topicNameOf(topic)}</span>
    </>
  );
  return onOpen === undefined ? (
    <Link
      className={className}
      to={topicPath(section.id, topic.id)}
      style={sectionStyle(section)}
      hidden={hidden}
    >
      {inside}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      style={sectionStyle(section)}
      hidden={hidden}
      aria-label={fill(strings.sections.topicWaiting, { name: topicNameOf(topic) })}
      onClick={onOpen}
    >
      {inside}
    </button>
  );
}
