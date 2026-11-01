import { approvedOnly, sectionName, sectionPath } from "../features/sections/model";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Topic } from "../api/sections";
import { isSectionId, type FeedSort } from "../api/types";
import { FeedGrid } from "../features/feed/FeedGrid";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed, type FeedState } from "../features/feed/useFeed";
import { FoundTopicTiles } from "../features/sections/TopicTiles";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import { findTopics } from "../lib/api";
import { useResource } from "../lib/useResource";
import { fill, plural, strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { ListCard } from "../ui/ListCard";
import "../ui/Button.css";
import "./SearchPage.css";

/** Typing pauses this long before the address, and the feed, follow. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Shorter than this is browsing, not searching. */
export const MIN_QUERY = 2;

interface Filters {
  q: string;
  sort: FeedSort;
  /** A section's id: any, also one no chip shows. */
  category: string | undefined;
}

const read = (params: URLSearchParams): Filters => {
  const category = params.get("category") ?? "";
  return {
    q: (params.get("q") ?? "").trim(),
    sort: params.get("sort") === "recent" ? "recent" : "popular",
    category: isSectionId(category) ? category : undefined,
  };
};

const write = (filters: Filters): Record<string, string> => ({
  ...(filters.q.length > 0 ? { q: filters.q } : {}),
  ...(filters.sort === "recent" ? { sort: "recent" } : {}),
  ...(filters.category !== undefined ? { category: filters.category } : {}),
});

/** How many popular lists an empty search points at instead. */
const SUGGESTIONS = 3;

/** Something to open when the words led nowhere: what people rank most, in the category if one is set. */
function Suggestions({ category, name }: { category: string | undefined; name: string }) {
  const popular = useFeed({ category, sort: "popular" });
  if (popular.state.status !== "ready" || popular.state.lists.length === 0) return null;
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
        {popular.state.lists.slice(0, SUGGESTIONS).map((list) => (
          <li key={list.id}>
            <ListCard list={list} />
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

export function SearchPage({
  store = sectionsStore,
  find = findTopics,
}: {
  store?: SectionsStore;
  find?: FindTopics;
}) {
  const [params, setParams] = useSearchParams();
  const filters = read(params);
  const { sections, known } = useSections(store);
  const name = filters.category === undefined ? "" : sectionName(filters.category, sections);
  const [typed, setTyped] = useState(filters.q);
  // Words that arrive by the address — from the bar's field, or a link — go
  // into the box; the box's own words, written to the address after the pause,
  // come back unchanged and are left alone.
  const [seen, setSeen] = useState(filters.q);
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (filters.q !== typed.trim()) setTyped(filters.q);
  }
  const searching = filters.q.length >= MIN_QUERY;

  const set = (next: Partial<Filters>) => setParams(write({ ...filters, ...next }));

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
  });
  const found = useFoundTopics(searching ? filters.q : undefined, filters.category, find);
  // The results wait for the topics too, so that nothing moves when they come.
  const results = found === null ? WAITING : feed.state;

  const where =
    filters.category === undefined ? (
      <Link to="/">{strings.search.browseHome}</Link>
    ) : (
      <Link to={sectionPath(filters.category)}>{name}</Link>
    );
  const noLists = results.status === "ready" && results.lists.length === 0;
  const topics = found ?? [];
  const nothing = searching && noLists && topics.length === 0;

  return (
    <section className="search">
      <SearchBox value={typed} onChange={setTyped} onSubmit={(q) => set({ q })} autoFocus />
      <div className="search__head">
        <h1 className="search__title">
          {searching ? fill(strings.search.title, { q: filters.q }) : strings.search.browse}
        </h1>
        {results.status === "ready" && (
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
          <Chip selected={filters.sort === "popular"} onClick={() => set({ sort: "popular" })}>
            {strings.search.mostRanked}
          </Chip>
          <Chip selected={filters.sort === "recent"} onClick={() => set({ sort: "recent" })}>
            {strings.search.newest}
          </Chip>
        </div>
      )}
      <div className="search__chips" role="group" aria-label={strings.search.categories}>
        <Chip
          selected={filters.category === undefined}
          onClick={() => set({ category: undefined })}
        >
          {strings.search.all}
        </Chip>
        {/* Every section anybody may open, in the order the site draws them: Other
            last. Only once known: the nine first, in their own order, reshuffled. */}
        {(known ? approvedOnly(sections) : []).map((section) => (
          <Chip
            key={section.id}
            selected={filters.category === section.id}
            onClick={() => set({ category: section.id })}
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
          {topics.length > 0 && (
            <section className="search__topics" aria-labelledby="search-topics">
              <h2 id="search-topics" className="search__subtitle">
                {strings.sections.topics}
              </h2>
              <FoundTopicTiles topics={topics} sections={sections} />
            </section>
          )}
          {/* Topics alone are an answer: no line saying nothing was published. */}
          {!(noLists && topics.length > 0) && (
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
