import {
  approvedOnly,
  OTHER,
  sectionName,
  sectionPath,
  sectionsNamed,
  topicNameOf,
  topicPath,
} from "../features/sections/model";
import { useSearchScope, type SearchScope } from "../app/searchScope";
import { usePageTitle } from "../app/pageTitle";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Topic } from "../api/sections";
import { isSectionId, type FeedSort } from "../api/types";
import { isOutOfSight } from "../features/community/hidden";
import { useHidden } from "../features/community/useHidden";
import { FeedGrid } from "../features/feed/FeedGrid";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed, type FeedState } from "../features/feed/useFeed";
import { useYours } from "../features/feed/yours";
import { SectionTile } from "../features/sections/SectionTile";
import { FoundTopicTiles } from "../features/sections/TopicTiles";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import { findTopics, loadTopic, noteSearchMiss } from "../lib/api";
import { useResource } from "../lib/useResource";
import { useWidthClass } from "../lib/useWidthClass";
import { fill, plural, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { ListCard } from "../ui/ListCard";
import "../ui/Button.css";
import "../features/sections/sections.css";
import "./SearchPage.css";

/** Typing pauses this long before the address, and the feed, follow. */
export const SEARCH_DEBOUNCE_MS = 300;

interface Filters {
  q: string;
  sort: FeedSort;
  /** A section's id: any, also one no chip shows. */
  category: string | undefined;
  /** One topic: its lists alone, whatever section is asked (CONTRACT K6). */
  topic: string | undefined;
}

/** A topic's id as the backend makes them; anything else in the address is not one. */
const TOPIC_ID = /^[A-Za-z0-9_-]{1,128}$/;

const read = (params: URLSearchParams): Filters => {
  const category = params.get("category") ?? "";
  return {
    q: (params.get("q") ?? "").trim(),
    sort: params.get("sort") === "recent" ? "recent" : "popular",
    category: isSectionId(category) ? category : undefined,
    topic: TOPIC_ID.test(params.get("topic") ?? "")
      ? (params.get("topic") ?? undefined)
      : undefined,
  };
};

const write = (filters: Filters): Record<string, string> => ({
  ...(filters.q.length > 0 ? { q: filters.q } : {}),
  ...(filters.sort === "recent" ? { sort: "recent" } : {}),
  ...(filters.category !== undefined ? { category: filters.category } : {}),
  ...(filters.topic !== undefined ? { topic: filters.topic } : {}),
});

/** How many popular lists an empty search points at instead. */
const SUGGESTIONS = 3;

/** Something to open when the words led nowhere: what people rank most, in the category if one is set. */
function Suggestions({ category, name }: { category: string | undefined; name: string }) {
  const popular = useFeed({ category, sort: "popular" });
  const yours = useYours();
  const { hidden } = useHidden();
  // A list hidden, or everything from an author hidden, stays out of sight here too.
  const shown =
    popular.state.status === "ready"
      ? popular.state.lists.filter((list) => !isOutOfSight(hidden, list)).slice(0, SUGGESTIONS)
      : [];
  if (shown.length === 0) return null;
  const heading =
    category === undefined
      ? strings.home.popular
      : fill(strings.search.popularIn, { category: name });
  return (
    <section className="search__suggestions" aria-labelledby="search-popular">
      <h2 id="search-popular" className="search__subtitle">
        {heading}
      </h2>
      <ul className="feed" aria-label={heading}>
        {shown.map((list) => (
          <li key={list.id}>
            <ListCard list={list} yours={yours(list)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export type FindTopics = (q: string, section?: string) => Promise<{ topics: Topic[] }>;

const NONE = { topics: [] };
const WAITING: FeedState = { status: "loading" };

/**
 * The approved topics named like the words, next to the lists: null until the
 * answer is in, and none when it could not be read, the lists being the
 * search's own answer.
 */
function useFoundTopics(
  q: string | undefined,
  category: string | undefined,
  find: FindTopics,
): Topic[] | null {
  const ask = useCallback(
    () => (q === undefined ? Promise.resolve(NONE) : find(q, category)),
    [q, category, find],
  );
  const { state } = useResource(`${q ?? ""}|${category ?? ""}`, ask);
  if (state.status === "loading") return null;
  return state.status === "ready"
    ? state.value.topics.filter((topic) => topic.status === "approved")
    : [];
}

const NO_TOPIC = () => Promise.resolve(null);

/**
 * The topic searched in, to name it: null while it is asked for, and when
 * it cannot be read the search still keeps to it, only without its name.
 */
function useTopicSearched(id: string | undefined, one: (id: string) => Promise<Topic>) {
  const ask = useCallback(() => (id === undefined ? NO_TOPIC() : one(id)), [id, one]);
  const { state } = useResource(id ?? "", ask);
  return state.status === "ready" ? state.value : null;
}

export function SearchPage({
  store = sectionsStore,
  find = findTopics,
  findTopic = loadTopic,
  noteMiss = noteSearchMiss,
}: {
  store?: SectionsStore;
  find?: FindTopics;
  /** One topic by its id, to name the topic searched in. */
  findTopic?: (id: string) => Promise<Topic>;
  /** Says a search found nothing anywhere, so staff see what people look for. */
  noteMiss?: (q: string) => Promise<void>;
}) {
  const [params, setParams] = useSearchParams();
  const filters = read(params);
  const { sections, known } = useSections(store);
  const name = filters.category === undefined ? "" : sectionName(filters.category, sections);
  const topic = useTopicSearched(filters.topic, findTopic);
  const topicHome = topic?.section ?? filters.category ?? OTHER;
  // Where the search looks, said by the field's chip; its cross widens it.
  const scope: SearchScope | null =
    filters.topic !== undefined
      ? topic === null
        ? null
        : { category: topicHome, topic: topic.id, name: topicNameOf(topic) }
      : filters.category !== undefined
        ? { category: filters.category, name }
        : null;
  useSearchScope(scope);
  const [typed, setTyped] = useState(filters.q);
  // Words that arrive by the address — from the bar's field, or a link — go
  // into the box; the box's own words, written to the address after the pause,
  // come back unchanged and are left alone.
  const [seen, setSeen] = useState(filters.q);
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (filters.q !== typed.trim()) setTyped(filters.q);
  }
  // Any words at all are a search, as in the app: one character is a whole
  // word in Japanese or Chinese (本 is Books).
  const searching = filters.q.length > 0;
  usePageTitle(searching ? fill(strings.search.title, { q: filters.q }) : strings.search.browse, {
    inBar: false,
  });

  // A search sent is a step Back returns from; a chip only narrows it, in place.
  const set = (next: Partial<Filters>) => setParams(write({ ...filters, ...next }));
  const narrow = (next: Partial<Filters>) =>
    setParams(write({ ...filters, ...next }), { replace: true });
  // Enter on the words the address already has (the pause put them there) is no new step.
  const send = (q: string) => (q.trim() === filters.q ? narrow({ q: q.trim() }) : set({ q }));

  // The wait reads the filters as they are when it ends, not as they were when
  // the typing started: a chip pressed during the pause must not be undone.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  });

  useEffect(() => {
    if (typed.trim() === latest.current.q) return;
    const timer = setTimeout(
      () => setParams(write({ ...latest.current, q: typed.trim() }), { replace: true }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [typed, setParams]);

  const feed = useFeed({
    q: searching ? filters.q : undefined,
    sort: filters.sort,
    category: filters.category,
    topic: filters.topic,
  });
  // Inside one topic the words look for its lists only.
  const found = useFoundTopics(
    searching && filters.topic === undefined ? filters.q : undefined,
    filters.category,
    find,
  );
  // The results wait for the topics too, so that nothing moves when they come.
  const results = found === null ? WAITING : feed.state;

  const where =
    topic !== null && filters.topic !== undefined ? (
      <Link to={topicPath(topicHome, topic.id)}>{topicNameOf(topic)}</Link>
    ) : filters.category === undefined ? (
      <Link to="/">{strings.search.browseHome}</Link>
    ) : (
      <Link to={sectionPath(filters.category)}>{name}</Link>
    );
  const noLists = results.status === "ready" && results.lists.length === 0;
  const topics = found ?? [];
  // Sections by any of their names, in any language: "аниме" finds Anime on
  // an English page. Not inside one section, where the words look for its lists.
  const named =
    searching && known && filters.category === undefined && filters.topic === undefined
      ? sectionsNamed(sections, filters.q)
      : [];
  const nothing = searching && noLists && topics.length === 0 && named.length === 0;

  // Once per search that found nothing anywhere: the address follows the
  // typing only after its pause, so this is not every keystroke.
  // From 600 px the bar's field is the search and the page's box is not
  // drawn. Arriving with the focus nowhere (the home page's box went with its
  // page), the heading takes it; arriving from the bar's field, it stays there.
  const wide = useWidthClass() !== "compact";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (wide && (document.activeElement === null || document.activeElement === document.body)) {
      heading.current?.focus({ preventScroll: true });
    }
    // Only on arrival: later searches keep the focus where the person put it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noted = useRef<string | null>(null);
  useEffect(() => {
    // Nothing inside one topic is not nothing anywhere.
    if (!nothing || filters.topic !== undefined || noted.current === filters.q) return;
    noted.current = filters.q;
    noteMiss(filters.q).catch(() => undefined);
  }, [nothing, filters.q, filters.topic, noteMiss]);

  return (
    <section className="search">
      <SearchBox
        value={typed}
        onChange={setTyped}
        onSubmit={send}
        autoFocus={!wide}
        place={scope?.name ?? null}
        onEverywhere={() => narrow({ category: undefined, topic: undefined })}
      />
      {/* Said aloud as it changes, what was asked and how much came. */}
      <div className="search__head" role="status">
        <h1 ref={heading} className="search__title" tabIndex={-1}>
          {searching ? fill(strings.search.title, { q: filters.q }) : strings.search.browse}
        </h1>
        {/* Sections or topics alone are the answer: no "0 lists" above them. */}
        {results.status === "ready" && !(noLists && (named.length > 0 || topics.length > 0)) && (
          <p className="search__count">
            {results.next === null
              ? plural(strings.search.count, results.lists.length)
              : plural(strings.search.countMore, results.lists.length)}
          </p>
        )}
      </div>
      {/* Words are matched against titles, and the backend orders those by
          title whatever is asked: an order chip would change nothing. */}
      {!searching && (
        <div className="search__chips" role="group" aria-label={strings.search.sortBy}>
          <Chip selected={filters.sort === "popular"} onClick={() => narrow({ sort: "popular" })}>
            {strings.search.mostRanked}
          </Chip>
          <Chip selected={filters.sort === "recent"} onClick={() => narrow({ sort: "recent" })}>
            {strings.search.newest}
          </Chip>
        </div>
      )}
      <div className="search__chips" role="group" aria-label={strings.search.categories}>
        <Chip
          selected={filters.category === undefined}
          onClick={() => narrow({ category: undefined, topic: undefined })}
        >
          {strings.search.all}
        </Chip>
        {/* Every section anybody may open, in the order the site draws them: Other
            last. Only once known: the nine first, in their own order, reshuffled. */}
        {(known ? approvedOnly(sections) : []).map((section) => (
          <Chip
            key={section.id}
            selected={filters.category === section.id}
            onClick={() => narrow({ category: section.id, topic: undefined })}
          >
            {section.name}
          </Chip>
        ))}
      </div>
      {nothing ? (
        <>
          <div className="search__empty">
            <p className="search__empty-title">{fill(strings.search.nothing, { q: filters.q })}</p>
            <p className="search__empty-body">{fillNodes(strings.search.browseHint, { where })}</p>
          </div>
          <p className="search__make">
            {/* The words become the list's name, and the section searched in its section. */}
            <Link
              className="btn btn--tonal"
              to={`/b/new?${new URLSearchParams({
                title: filters.q,
                ...(filters.category !== undefined ? { category: filters.category } : {}),
              }).toString()}`}
            >
              <Icon name="add" className="btn__icon" />
              <span>{strings.search.makeThis}</span>
            </Link>
          </p>
          <Suggestions category={filters.category} name={name} />
        </>
      ) : (
        <>
          {named.length > 0 && (
            <section className="search__topics" aria-labelledby="search-sections">
              <h2 id="search-sections" className="search__subtitle">
                {strings.sections.sections}
              </h2>
              <nav className="sections-grid" aria-label={strings.sections.sections}>
                {named.map((section) => (
                  <SectionTile key={section.id} section={section} />
                ))}
              </nav>
            </section>
          )}
          {topics.length > 0 && (
            <section className="search__topics" aria-labelledby="search-topics">
              <h2 id="search-topics" className="search__subtitle">
                {strings.sections.topics}
              </h2>
              <FoundTopicTiles topics={topics} sections={sections} />
            </section>
          )}
          {/* Sections or topics alone are an answer: no line saying nothing was published. */}
          {(named.length > 0 || topics.length > 0) && !noLists && results.status === "ready" && (
            <h2 className="search__subtitle">{strings.profile.lists}</h2>
          )}
          {!(noLists && (named.length > 0 || topics.length > 0)) && (
            <FeedGrid
              state={results}
              label={strings.search.results}
              retry={feed.retry}
              more={feed.more}
              hiddenNote
            />
          )}
        </>
      )}
    </section>
  );
}
