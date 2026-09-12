import { Link, Outlet } from "react-router";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import "./Shell.css";

export const PLAY_URL = "https://play.google.com/store/apps/details?id=com.artiuillab.tieryourlife";

export function Shell() {
  return (
    <div className="shell">
      <header className="top">
        <Link className="brand" to="/">
          <span className="brand__mark" aria-hidden="true">
            T
          </span>
          <span className="brand__name">{strings.brand}</span>
        </Link>
        <nav className="top__actions" aria-label="Site">
          <Button disabled>{strings.nav.signIn}</Button>
          <details className="menu">
            <summary className="menu__button" aria-label={strings.nav.more}>
              <Icon name="more_vert" />
            </summary>
            <ul className="menu__list">
              <li>
                <a href={PLAY_URL} target="_blank" rel="noopener">
                  {strings.nav.keepOnPhone}
                </a>
              </li>
            </ul>
          </details>
        </nav>
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
      <footer className="foot">
        <a href="/privacy.html">{strings.footer.privacy}</a>
        <a href={PLAY_URL} target="_blank" rel="noopener">
          {strings.nav.keepOnPhone}
        </a>
        <p className="foot__attribution">{strings.footer.tmdb}</p>
      </footer>
    </div>
  );
}
