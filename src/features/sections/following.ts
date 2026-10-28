import type { Following } from "../../api/community";
import type { ListSummary } from "../../api/types";
import { fill, strings } from "../../strings";

/** What one follows, as sets to look a list up in. */
export interface Followed {
  authors: ReadonlySet<string>;
  /** Topic id → its name. */
  topics: ReadonlyMap<string, string>;
  sections: ReadonlySet<string>;
}

export const NOTHING_FOLLOWED: Followed = {
  authors: new Set(),
  topics: new Map(),
  sections: new Set(),
};

export function followedOf(following: Following): Followed {
  return {
    authors: new Set(following.authors.map((author) => author.uid)),
    topics: new Map(following.topics.map((topic) => [topic.id, topic.name])),
    sections: new Set(following.sections.map((section) => section.id)),
  };
}

/**
 * Why a list is in somebody's Following feed, the way the app words it: a
 * person followed needs no line, their face is on the card; then a topic, by
 * its name; then a section, "In Anime". The backend does not say which, so it
 * is read off the list against what the person follows.
 */
export function reasonFor(
  list: Pick<ListSummary, "authorUid" | "category"> & { topicId?: string | null },
  followed: Followed,
  sectionName: (id: string) => string,
): string | null {
  if (list.authorUid !== "" && followed.authors.has(list.authorUid)) return null;
  const topic = list.topicId ? followed.topics.get(list.topicId) : undefined;
  if (topic !== undefined) return topic;
  if (followed.sections.has(list.category)) {
    return fill(strings.sections.reasonSection, { name: sectionName(list.category) });
  }
  return null;
}
