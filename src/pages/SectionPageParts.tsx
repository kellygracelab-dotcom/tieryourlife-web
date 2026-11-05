import { Fragment, useCallback, type ReactNode } from "react";
import { Navigate } from "react-router";
import type { SectionStats } from "../api/sections";
import { isCategory, type FeedSort } from "../api/types";
import type { Report } from "../features/community/useReporting";
import type { LoadFeed } from "../features/feed/useFeed";
import {
  builtInSection,
  sectionPath,
  sectionStyle,
  topicPath,
  servedPicture,
  topicPicture,
  type Section,
} from "../features/sections/model";
import { heldSection, useSections, type SectionsStore } from "../features/sections/useSections";
import { useResource } from "../lib/useResource";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { NotFoundPage } from "./NotFoundPage";
import type { TopicDeps } from "./SectionPageState";
import "./SectionPage.css";

/** What a section's page and a topic's page are given, all of it replaceable in a test. */
export interface SectionPageProps {
  load?: LoadFeed;
  store?: SectionsStore;
  topics?: TopicDeps;
  /** One section by its id, for one the sections do not hold. */
  loadOne?: (id: string) => Promise<SectionStats>;
  /** Where a topic page's reports go: "Not this topic" and Report alike. */
  report?: Report;
}

/**
 * The header's art: four covers when the section has them, its own art
 * otherwise. A topic's page never borrows the section's covers: it draws the
 * topic's own picture over the section's art, which shows until the picture
 * has come, or the art alone.
 */
export function HeadArt({
  section,
  topic,
}: {
  section: Section;
  topic?: { pictureUrl?: string | null };
}) {
  const picture = topic === undefined ? null : topicPicture(topic);
  const collage = topic === undefined && section.collage.length > 0;
  return (
    <div
      className={
        collage
          ? "section-head__art"
          : `section-head__art section-head__art--own${section.picture === null ? "" : " section-head__art--pictured"}`
      }
      style={sectionStyle(section, 1600)}
      aria-hidden="true"
    >
      {collage && section.collage.map((url) => <img key={url} src={url} alt="" />)}
      {picture !== null && <img src={servedPicture(picture, 1600)} alt="" decoding="async" />}
    </div>
  );
}

/** Popular or Newest, at the end of the row; the row may lead with something of its own. */
export function SortRow({
  sort,
  onSort,
  children,
}: {
  sort: FeedSort;
  onSort: (sort: FeedSort) => void;
  children?: ReactNode;
}) {
  return (
    <div className="section-sort">
      {children}
      <label className="section-sort__order">
        <select
          aria-label={strings.search.sortBy}
          value={sort}
          onChange={(event) => onSort(event.target.value === "recent" ? "recent" : "popular")}
        >
          <option value="popular">{strings.sections.sortPopular}</option>
          <option value="recent">{strings.sections.sortNewest}</option>
        </select>
        <Icon name="expand_more" />
      </label>
    </div>
  );
}

export function SectionLoading() {
  return (
    <section className="section-page" aria-busy="true">
      <Skeleton height="200px" />
    </section>
  );
}

/** Something could not be asked about: why, and another try. */
export function SectionTrouble({ offline, retry }: { offline: boolean; retry: () => void }) {
  return (
    <section className="section-page">
      <div className="feed__trouble" role="alert">
        <p>{offline ? strings.feed.offline : strings.feed.failed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    </section>
  );
}

interface SectionRouteProps {
  id: string;
  store: SectionsStore;
  loadOne: (id: string) => Promise<SectionStats>;
  /** The page once the section is known; drawn afresh for another section. */
  children: (section: Section) => ReactNode;
}

/**
 * The section an address names, for its own page and for its topics' pages:
 * one of the sections, one of the nine before they have answered, or else
 * asked about by its id and then held by the store, so that Follow on it
 * turns like any other.
 */
export function SectionRoute({ id, store, loadOne, children }: SectionRouteProps) {
  const snapshot = useSections(store);
  const known = heldSection(snapshot, id);
  const section = known ?? (isCategory(id) ? builtInSection(id) : null);
  // Held once the answer is in, before the page is drawn from it.
  const lookUp = useCallback(
    (one: string) =>
      loadOne(one).then((stats) => {
        store.keep(stats);
        return stats;
      }),
    [loadOne, store],
  );
  if (section !== null) return <Fragment key={section.id}>{children(section)}</Fragment>;
  // Not among the sections, which may not have answered yet: asked about on
  // its own only once they have.
  if (!snapshot.loaded && !snapshot.failed) return <SectionLoading />;
  return <UnlistedSection key={id} id={id} loadOne={lookUp} />;
}

/**
 * A section no tile shows, asked about by its id once: hidden, approved since
 * the sections were read, or merged into another, whose address it leads to
 * now. Nothing by that id is Not found. Once found, the store holds it and
 * the route draws it.
 */
function UnlistedSection({
  id,
  loadOne,
}: {
  id: string;
  loadOne: (id: string) => Promise<SectionStats>;
}) {
  const { state, retry } = useResource(id, loadOne);
  if (state.status !== "error") return <SectionLoading />;
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
  return <SectionTrouble offline={error.kind === "offline"} retry={retry} />;
}
