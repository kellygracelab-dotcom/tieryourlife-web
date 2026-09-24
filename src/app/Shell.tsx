import { useEffect, useState } from "react";
import { Link, Outlet, ScrollRestoration } from "react-router";
import { useModerator } from "../features/moderation/useModerator";
import type { Account } from "../lib/account";
import { PLAY_URL } from "../lib/links";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { PageTitleContext, TITLE_AFTER_PX } from "./pageTitle";
import { useSession } from "./session";
import "./Shell.css";

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

/** Where a signed-in person's own things are. Signing out is a setting, and lives with the settings. */
function AccountMenu({ account }: { account: Extract<Account, { kind: "signedIn" }> }) {
  const moderator = useModerator();
  return (
    <Menu
      label={strings.nav.account}
      buttonClassName="menu__button menu__button--face"
      button={
        <>
          {account.photoUrl !== null ? (
            <img className="face" src={account.photoUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="face face--initial">{initialOf(account.displayName)}</span>
          )}
          <Icon name="expand_more" className="menu__chevron" />
        </>
      }
    >
      <>
        <li className="menu__who">{account.displayName ?? strings.nav.you}</li>
        <li>
          <Link to="/me">{strings.nav.yourRankings}</Link>
        </li>
        <li>
          <Link to="/me/lists">{strings.nav.myLists}</Link>
        </li>
        <li>
          <Link to="/settings">{strings.nav.settings}</Link>
        </li>
        {moderator.status === "yes" && (
          <li>
            <Link to="/mod" className="menu__row">
              <span>{strings.nav.reports}</span>
              {moderator.reports.length > 0 && (
                <span className="menu__pill">{moderator.reports.length}</span>
              )}
            </Link>
          </li>
        )}
      </>
    </Menu>
  );
}

export function Shell() {
  const { account, signIn } = useSession();
  const [signing, setSigning] = useState<"idle" | "busy" | "failed" | "inApp">("idle");

  // On a phone the list's heading scrolls away under the tray's work; once it
  // has, the app bar says what the page is instead of the brand.
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > TITLE_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const titled = pageTitle !== null && scrolled;

  const onSignIn = () => {
    setSigning("busy");
    signIn().then((outcome) =>
      setSigning(
        outcome.kind !== "failed" ? "idle" : outcome.code === IN_APP_BROWSER ? "inApp" : "failed",
      ),
    );
  };

  return (
    <div className="shell">
      <header className={titled ? "top top--titled" : "top"}>
        <Link className="brand" to="/">
          <img className="brand__mark" src="/favicon.svg" alt="" width="26" height="26" />
          <span className="brand__name">{strings.brand}</span>
        </Link>
        {/* The page's own heading is still there for a screen reader; this is for the eye. */}
        {titled && (
          <span className="top__title" aria-hidden="true">
            {pageTitle}
          </span>
        )}
        <nav className="top__actions" aria-label="Site">
          <Link className="btn btn--tonal top__make" to="/new" aria-label={strings.nav.makeList}>
            <Icon name="add" className="btn__icon top__make-icon" />
            <span className="top__make-text">{strings.nav.makeList}</span>
          </Link>
          {account?.kind === "signedIn" ? (
            <AccountMenu account={account} />
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
        </nav>
      </header>
      {signing === "inApp" && (
        <p className="top__banner" role="alert">
          {strings.keep.inApp}
        </p>
      )}
      <main className="shell__main">
        <PageTitleContext.Provider value={setPageTitle}>
          <Outlet />
        </PageTitleContext.Provider>
      </main>
      <footer className="foot">
        <a href="/privacy.html">{strings.footer.privacy}</a>
        <a href={PLAY_URL} target="_blank" rel="noopener">
          {strings.nav.keepOnPhone}
        </a>
        <Link to="/about">{strings.footer.about}</Link>
        {/* The theme is a setting a guest has too, and a guest has no account menu to find it in. */}
        <Link to="/settings">{strings.nav.settings}</Link>
      </footer>
      {/* A new page opens at its top, and Back returns to where the person was. */}
      <ScrollRestoration />
    </div>
  );
}
