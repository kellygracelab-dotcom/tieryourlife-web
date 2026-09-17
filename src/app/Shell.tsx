import { useRef, useState } from "react";
import { Link, Outlet } from "react-router";
import type { Account } from "../lib/account";
import { PLAY_URL } from "../lib/links";
import { THEMES, type Theme } from "../lib/theme";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useSession } from "./session";
import { useTheme } from "./useTheme";
import "./Shell.css";

const THEME_TEXT: Record<Theme, string> = {
  system: strings.nav.themeSystem,
  light: strings.nav.themeLight,
  dark: strings.nav.themeDark,
};

function ThemeSwitch() {
  const { theme, choose } = useTheme();
  return (
    <div className="theme" role="radiogroup" aria-label={strings.nav.theme}>
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          className="theme__option"
          onClick={() => choose(option)}
        >
          {THEME_TEXT[option]}
        </button>
      ))}
    </div>
  );
}

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

function AccountMenu({
  account,
  onSignOut,
}: {
  account: Extract<Account, { kind: "signedIn" }>;
  onSignOut: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (menu.current !== null) menu.current.open = false;
  };
  return (
    <details className="menu" ref={menu}>
      <summary className="menu__button menu__button--face" aria-label={strings.nav.account}>
        {account.photoUrl !== null ? (
          <img className="face" src={account.photoUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="face face--initial">{initialOf(account.displayName)}</span>
        )}
      </summary>
      <ul className="menu__list" onClick={close}>
        <li className="menu__who">{account.displayName ?? strings.nav.you}</li>
        <li>
          <Link to="/me">{strings.nav.yourRankings}</Link>
        </li>
        <li>
          <Link to="/me/lists">{strings.nav.myLists}</Link>
        </li>
        <li>
          <button type="button" className="menu__action" onClick={onSignOut}>
            {strings.nav.signOut}
          </button>
        </li>
      </ul>
    </details>
  );
}

export function Shell() {
  const { account, signIn, signOut } = useSession();
  const [signing, setSigning] = useState<"idle" | "busy" | "failed">("idle");

  const onSignIn = () => {
    setSigning("busy");
    signIn().then((outcome) => setSigning(outcome.kind === "failed" ? "failed" : "idle"));
  };

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
          <Link className="btn btn--tonal top__make" to="/new">
            <span>{strings.nav.makeList}</span>
          </Link>
          {account?.kind === "signedIn" ? (
            <AccountMenu account={account} onSignOut={() => void signOut()} />
          ) : (
            <>
              {signing === "failed" && (
                <span className="top__note" role="alert">
                  {strings.nav.signInFailed}
                </span>
              )}
              <Button onClick={onSignIn} disabled={signing === "busy"}>
                {strings.nav.signIn}
              </Button>
            </>
          )}
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
              <li className="menu__theme">
                <span className="menu__who">{strings.nav.theme}</span>
                <ThemeSwitch />
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
