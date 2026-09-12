import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import "./HomePage.css";

export function HomePage() {
  return (
    <section className="home">
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
  );
}
