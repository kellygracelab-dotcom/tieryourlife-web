import { useState } from "react";
import { useNavigate } from "react-router";
import { CategoryTiles } from "../features/feed/CategoryTiles";
import { FeedGrid } from "../features/feed/FeedGrid";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed } from "../features/feed/useFeed";
import { strings } from "../strings";
import "./HomePage.css";

export function HomePage() {
  const popular = useFeed({ sort: "popular" });
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  return (
    <div className="home">
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
