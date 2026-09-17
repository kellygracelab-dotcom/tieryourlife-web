import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CATEGORIES, isCategory, type Category, type FeedSort } from "../api/types";
import { FeedGrid } from "../features/feed/FeedGrid";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed } from "../features/feed/useFeed";
import { fill, formatCount, plural, strings } from "../strings";
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
  category: Category | undefined;
}

const read = (params: URLSearchParams): Filters => {
  const category = params.get("category") ?? "";
  return {
    q: (params.get("q") ?? "").trim(),
    sort: params.get("sort") === "recent" ? "recent" : "popular",
    category: isCategory(category) ? category : undefined,
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
function Suggestions({ category }: { category: Category | undefined }) {
  const popular = useFeed({ category, sort: "popular" });
  if (popular.state.status !== "ready" || popular.state.lists.length === 0) return null;
  const heading =
    category === undefined
      ? strings.home.popular
      : fill(strings.search.popularIn, { category: strings.category[category] });
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

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const filters = read(params);
  const [typed, setTyped] = useState(filters.q);
  const searching = filters.q.length >= MIN_QUERY;

  const set = (next: Partial<Filters>) => setParams(write({ ...filters, ...next }));

  useEffect(() => {
    if (typed.trim() === filters.q) return;
    const timer = setTimeout(
      () => setParams(write({ ...filters, q: typed.trim() }), { replace: true }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // Only what was typed should restart the wait; the filters travel with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const feed = useFeed({
    q: searching ? filters.q : undefined,
    sort: filters.sort,
    category: filters.category,
  });

  const where =
    filters.category === undefined ? (
      <Link to="/">{strings.search.browseHome}</Link>
    ) : (
      <Link to={`/c/${filters.category}`}>{strings.category[filters.category]}</Link>
    );
  const nothing = searching && feed.state.status === "ready" && feed.state.lists.length === 0;

  return (
    <section className="search">
      <SearchBox value={typed} onChange={setTyped} onSubmit={(q) => set({ q })} autoFocus />
      <div className="search__head">
        <h1 className="search__title">
          {searching ? fill(strings.search.title, { q: filters.q }) : strings.search.browse}
        </h1>
        {feed.state.status === "ready" && (
          <p className="search__count">
            {feed.state.next === null
              ? plural(strings.search.count, feed.state.lists.length)
              : fill(strings.search.countMore, { n: formatCount(feed.state.lists.length) })}
          </p>
        )}
      </div>
      <div className="search__chips" role="group" aria-label={strings.search.sortBy}>
        <Chip selected={filters.sort === "popular"} onClick={() => set({ sort: "popular" })}>
          {strings.search.mostRanked}
        </Chip>
        <Chip selected={filters.sort === "recent"} onClick={() => set({ sort: "recent" })}>
          {strings.search.newest}
        </Chip>
      </div>
      <div className="search__chips" role="group" aria-label={strings.search.categories}>
        <Chip
          selected={filters.category === undefined}
          onClick={() => set({ category: undefined })}
        >
          {strings.search.all}
        </Chip>
        {CATEGORIES.map((id) => (
          <Chip key={id} selected={filters.category === id} onClick={() => set({ category: id })}>
            {strings.category[id]}
          </Chip>
        ))}
      </div>
      {nothing ? (
        <>
          <p className="search__empty">
            {strings.search.nothing} {strings.search.browseOr} {where}.
          </p>
          <p className="search__make">
            <Link className="btn btn--tonal" to={`/new?title=${encodeURIComponent(filters.q)}`}>
              <Icon name="add" className="btn__icon" />
              <span>{strings.search.makeThis}</span>
            </Link>
          </p>
          <Suggestions category={filters.category} />
        </>
      ) : (
        <FeedGrid
          state={feed.state}
          label={strings.search.results}
          retry={feed.retry}
          more={feed.more}
          hiddenNote
        />
      )}
    </section>
  );
}
