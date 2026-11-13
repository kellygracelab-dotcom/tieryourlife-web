import tmdbLogo from "../assets/tmdb.svg";
import { appIsLive, onApple, playUrl } from "../lib/links";
import { strings } from "../strings";
import { fillNodes } from "../strings/fillNodes";
import { Icon } from "../ui/Icon";
import "./AboutPage.css";
import { usePageTitle } from "../app/pageTitle";

const TMDB_URL = "https://www.themoviedb.org";
const IGDB_URL = "https://www.igdb.com";

/**
 * What the site is, whose data it shows, and where a person's own data is
 * dealt with. TMDB's terms ask for their logo and their sentence, word for
 * word, in an "About" or "Credits" section; the logo stays smaller than ours.
 * IGDB's ask for its name, IGDB.com, as a link to its site.
 */
export function AboutPage() {
  usePageTitle(strings.about.title, { inBar: false });
  return (
    <div className="about">
      <h1 className="about__heading">{strings.about.title}</h1>

      <section className="about__card" aria-labelledby="about-what">
        <h2 id="about-what" className="about__title about__title--brand">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          {strings.brand}
        </h2>
        <p className="about__text">{strings.about.what}</p>
      </section>

      <section className="about__card" aria-labelledby="about-app">
        <h2 id="about-app" className="about__title">
          {strings.android.footer}
        </h2>
        <p className="about__text">{strings.android.aboutBody}</p>
        {!appIsLive() ? (
          <p className="about__text about__text--quiet">{strings.android.aboutTesting}</p>
        ) : (
          !onApple() && (
            <>
              <a className="about__row" href={playUrl("about")} target="_blank" rel="noopener">
                <span>{strings.android.get}</span>
                <Icon name="open_in_new" className="about__row-icon" />
              </a>
              <p className="about__text about__text--quiet about__computer">
                {strings.android.aboutComputer}
              </p>
            </>
          )
        )}
      </section>

      <section className="about__card" aria-labelledby="about-credits">
        <h2 id="about-credits" className="about__title">
          {strings.about.creditsTitle}
        </h2>
        <p className="about__text">{strings.about.catalogue}</p>
        <p className="about__text">{strings.about.wikidata}</p>
        <p className="about__text">
          {fillNodes(strings.about.igdb, {
            igdb: (
              <a href={IGDB_URL} target="_blank" rel="noopener" dir="ltr">
                IGDB.com
              </a>
            ),
          })}
        </p>
        <a className="about__tmdb" href={TMDB_URL} target="_blank" rel="noopener">
          <img src={tmdbLogo} alt={strings.about.tmdbLogo} width="123" height="16" />
        </a>
        {/* TMDB's sentence stays in English in every language, so it is read as English. */}
        <p className="about__notice" lang="en" dir="ltr">
          {strings.about.tmdb}
        </p>
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
