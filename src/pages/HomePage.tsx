import { CategoryTiles } from "../features/feed/CategoryTiles";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed } from "../features/feed/useFeed";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import "./HomePage.css";

export function HomePage() {
  const popular = useFeed({ sort: "popular" });
  return (
    <div className="home">
      <section className="home__intro">
        <h1 className="home__hero">{strings.home.hero}</h1>
        <div className="home__search" role="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder={strings.home.searchPlaceholder}
            aria-label={strings.home.searchPlaceholder}
            disabled
          />
        </div>
        <p className="home__note">{strings.home.searchSoon}</p>
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
