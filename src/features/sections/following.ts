import type { Following } from "../../api/community";
import type { ApiError } from "../../api/errors";
import type { ListSummary } from "../../api/types";
import { fill, strings } from "../../strings";
import { sectionOf, topicNameOf, type Section } from "./model";
import { heldSection, type SectionsSnapshot } from "./useSections";

/**
 * The sections one follows: the store's word for those it holds, since a
 * follow made on this visit turns it at once, and the backend's for the rest:
 * a hidden section, one approved since the sections were read, or all of them
 * while the nine stand in for sections that would not load.
 */
export function followedSectionIds(
  snapshot: SectionsSnapshot,
  backend: readonly string[] | null,
): string[] {
  const held = new Map<string, boolean>();
  if (snapshot.followsKnown) snapshot.sections.forEach((one) => held.set(one.id, one.following));
  snapshot.extra.forEach((one) => {
    if (!held.has(one.id)) held.set(one.id, one.following);
  });
  const ids = [...held].filter(([, on]) => on).map(([id]) => id);
  (backend ?? []).forEach((id) => {
    if (!held.has(id) && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

/** A followed section to draw: as the store holds it, or by its id until it has been asked about. */
export const followedSectionOf = (snapshot: SectionsSnapshot, id: string): Section =>
  heldSection(snapshot, id) ??
  sectionOf({ id, listCount: 0, followerCount: 0, newThisWeek: 0, collage: [], following: true });

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
    topics: new Map(following.topics.map((topic) => [topic.id, topicNameOf(topic)])),
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

/**
 * What a refused follow or unfollow of a section or topic says. At the
 * ceiling another try is refused the same way, so it says what to do instead;
 * people have a ceiling of their own, said in `limit`.
 */
export const followRefusal = (
  error: ApiError,
  following: boolean,
  limit: string = strings.sections.followLimit,
): string =>
  error.kind === "tooManyFollowing"
    ? limit
    : following
      ? strings.sections.followFailed
      : strings.sections.unfollowFailed;
