import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { CategoryTiles } from "../features/feed/CategoryTiles";
import { FeedGrid } from "../features/feed/FeedGrid";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed } from "../features/feed/useFeed";
import { strings } from "../strings";
import "./HomePage.css";

/** The one line after an account is deleted stays this long. */
export const DELETED_NOTE_MS = 8000;

export function HomePage() {
  const popular = useFeed({ sort: "popular" });
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const arrivedAfterDeletion =
    (location.state as { accountDeleted?: boolean } | null)?.accountDeleted === true;
  const [deletedNote, setDeletedNote] = useState(arrivedAfterDeletion);

  useEffect(() => {
    if (!deletedNote) return;
    const timer = setTimeout(() => setDeletedNote(false), DELETED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [deletedNote]);

  return (
    <div className="home">
      {deletedNote && (
        <p className="home__notice" role="status">
          {strings.settings.deleted}
        </p>
      )}
      <section className="home__intro">
        <h1 className="home__hero">{strings.home.hero}</h1>
        <SearchBox
          value={query}
          onChange={setQuery}
          onSubmit={(q) => void navigate(`/search?q=${encodeURIComponent(q)}`)}
        />
      </section>

      <CategoryTiles />

      <section className="home__popular" aria-labelledby="popular">
        <div className="home__heading">
          <h2 id="popular">{strings.home.popular}</h2>
          <p>{strings.home.popularNote}</p>
        </div>
        <FeedGrid
          state={popular.state}
          label={strings.home.popular}
          retry={popular.retry}
          more={popular.more}
          paged={false}
        />
      </section>
    </div>
  );
}
