import tmdbLogo from "../assets/tmdb.svg";
import { PLAY_URL } from "../lib/links";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import "./AboutPage.css";

const TMDB_URL = "https://www.themoviedb.org";

/**
 * What the site is, whose data it shows, and where a person's own data is
 * dealt with. TMDB's terms ask for their logo and their sentence, word for
 * word, in an "About" or "Credits" section; the logo stays smaller than ours.
 */
export function AboutPage() {
  return (
    <div className="about">
      <h1 className="about__heading">{strings.about.title}</h1>

      <section className="about__card" aria-labelledby="about-what">
        <h2 id="about-what" className="about__title about__title--brand">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          {strings.brand}
        </h2>
        <p className="about__text">{strings.about.what}</p>
        <a className="about__row" href={PLAY_URL} target="_blank" rel="noopener">
          <span>{strings.nav.keepOnPhone}</span>
          <Icon name="open_in_new" className="about__row-icon" />
        </a>
      </section>

      <section className="about__card" aria-labelledby="about-credits">
        <h2 id="about-credits" className="about__title">
          {strings.about.creditsTitle}
        </h2>
        <p className="about__text">{strings.about.catalogue}</p>
        <a className="about__tmdb" href={TMDB_URL} target="_blank" rel="noopener">
          <img src={tmdbLogo} alt={strings.about.tmdbLogo} width="123" height="16" />
        </a>
        <p className="about__notice">{strings.about.tmdb}</p>
      </section>

      <section className="about__card" aria-labelledby="about-data">
        <h2 id="about-data" className="about__title">
          {strings.about.dataTitle}
        </h2>
        <a className="about__row" href="/privacy.html" target="_blank" rel="noopener">
          <span>{strings.footer.privacy}</span>
          <Icon name="open_in_new" className="about__row-icon" />
        </a>
        <a className="about__row" href="/delete-account.html" target="_blank" rel="noopener">
          <span>{strings.about.deleteAccount}</span>
          <Icon name="open_in_new" className="about__row-icon" />
        </a>
      </section>
    </div>
  );
}
