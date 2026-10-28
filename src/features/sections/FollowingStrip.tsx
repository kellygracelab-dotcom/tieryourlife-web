import { Link } from "react-router";
import type { FollowedAuthor } from "../../api/community";
import type { Topic } from "../../api/sections";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import {
  MANAGE_PATH,
  sectionPath,
  sectionStyle,
  topicPath,
  topicStyle,
  type Section,
} from "./model";
import "./following.css";

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

interface FollowingStripProps {
  sections: readonly Section[];
  topics: readonly Topic[];
  people: readonly FollowedAuthor[];
  /** The sections the topics belong to, for their colours. */
  sectionOf: (id: string | null) => Section | undefined;
}

/**
 * Everything the Following feed is made of, above it, as the app shows it:
 * sections, topics, people, and last the way to manage them.
 */
export function FollowingStrip({ sections, topics, people, sectionOf }: FollowingStripProps) {
  return (
    <nav className="following-strip" aria-label={strings.sections.tabFollowing}>
      <ul className="following-strip__items">
        {sections.map((section) => (
          <li key={`s-${section.id}`}>
            <Link className="following-strip__item" to={sectionPath(section.id)}>
              <span
                className={[
                  "following-strip__visual following-strip__section",
                  section.picture === null ? "" : "following-strip__section--pictured",
                  section.status === "pending" ? "following-strip__visual--waiting" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={sectionStyle(section)}
                aria-hidden="true"
              >
                <Icon name={section.icon} />
              </span>
              <span className="following-strip__name">{section.name}</span>
            </Link>
          </li>
        ))}
        {topics.map((topic) => {
          const section = sectionOf(topic.section);
          return (
            <li key={`t-${topic.id}`}>
              <Link
                className="following-strip__item"
                to={topicPath(topic.section ?? "other", topic.id)}
              >
                <span
                  className={
                    topic.status === "pending"
                      ? "following-strip__visual following-strip__topic following-strip__visual--waiting"
                      : "following-strip__visual following-strip__topic"
                  }
                  style={topicStyle(section)}
                  aria-hidden="true"
                >
                  <Icon name={section?.icon ?? "label"} />
                </span>
                <span className="following-strip__name">{topic.name}</span>
              </Link>
            </li>
          );
        })}
        {people.map((person) => (
          <li key={`p-${person.uid}`}>
            <Link
              className="following-strip__item"
              to={`/u/${encodeURIComponent(person.uid)}`}
              state={{ author: { name: person.name, photoUrl: person.photoUrl } }}
            >
              {person.photoUrl !== null ? (
                <img
                  className="following-strip__visual following-strip__face"
                  src={person.photoUrl}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span
                  className="following-strip__visual following-strip__face following-strip__face--initial"
                  aria-hidden="true"
                >
                  {initialOf(person.name)}
                </span>
              )}
              <span className="following-strip__name">
                {person.name.trim() || strings.profile.someone}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link className="following-strip__item" to={MANAGE_PATH}>
            <span className="following-strip__visual following-strip__manage" aria-hidden="true">
              <Icon name="tune" />
            </span>
            <span className="following-strip__name">{strings.sections.manage}</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
