import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  Link,
  Outlet,
  ScrollRestoration,
  type Location,
  useLocation,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useAdminCounts } from "../features/admin/useAdminCounts";
import { useModerator } from "../features/moderation/useModerator";
import type { Account } from "../lib/account";
import { appIsLive, onApple, playUrl } from "../lib/links";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { lastSeen } from "../lib/signedInHint";
import { storageRefused, subscribeToStorageTrouble } from "../lib/storage";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { ClearButton } from "../ui/ClearButton";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { documentTitleOf, PageTitleContext, TITLE_AFTER_PX, type PageName } from "./pageTitle";
import { useScrollCatchUp } from "./scrollCatchUp";
import { useRedirectFailed, useSession } from "./session";
import "./Shell.css";

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

/** The app in the footer: a link once anyone can get it, plain words until then, nothing on an iPhone. */
function AppFooterLink() {
  if (onApple()) return null;
  return appIsLive() ? (
    <a className="foot__app" href={playUrl("footer")} target="_blank" rel="noopener">
      <Icon name="install_mobile" />
      {strings.android.footer}
    </a>
  ) : (
    <span className="foot__app">{strings.android.footerSoon}</span>
  );
}

/** A signed-in person's face in the header, or the first letter of their name. */
function FaceOf({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  return photoUrl !== null ? (
    <img className="face" src={photoUrl} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="face face--initial">{initialOf(name)}</span>
  );
}

/** Where a signed-in person's own things are. Signing out is a setting, and lives with the settings. */
function AccountMenu({ account }: { account: Extract<Account, { kind: "signedIn" }> }) {
  const moderator = useModerator();
  const waiting = useAdminCounts(
    moderator.status === "yes" ? account.uid : null,
    moderator.status === "yes" ? moderator.reports.length : 0,
  );
  return (
    <Menu
      label={strings.nav.account}
      buttonClassName="menu__button menu__button--face"
      button={
        <>
          <FaceOf name={account.displayName} photoUrl={account.photoUrl} />
          <Icon name="expand_more" className="menu__chevron" />
        </>
      }
    >
      <>
        <li className="menu__who">{account.displayName ?? strings.nav.you}</li>
        <li>
          <Link to="/b">{strings.nav.boards}</Link>
        </li>
        <li>
          <Link to="/me">{strings.nav.myLists}</Link>
        </li>
        {appIsLive() && !onApple() && (
          <li>
            <a href={playUrl("menu")} target="_blank" rel="noopener">
              {strings.android.menu}
            </a>
          </li>
        )}
        {/* Only the owner and moderators: the backend answers the queue to nobody else. */}
        {moderator.status === "yes" && (
          <li>
            <Link to="/admin" className="menu__row">
              <Icon name="admin_panel_settings" />
              <span>{strings.admin.menu}</span>
              {waiting > 0 && <span className="menu__pill">{waiting}</span>}
            </Link>
          </li>
        )}
        <li>
          <Link to="/settings">{strings.nav.settings}</Link>
        </li>
      </>
    </Menu>
  );
}

/** Where each of the app's two tabs is "here": your own lists, or everybody's. */
const OWN_PAGES = /^\/(b|trash)(\/|$)/;
const COMMUNITY_PAGES = /^\/(following|s|search|l|u|r)?(\/|$)/;

/**
 * The app's two places, Your lists and Community, as tabs: in the bar from
 * 600, and on a phone in a row under it on the pages they lead to.
 */
function SiteTabs({ className, pathname }: { className: string; pathname: string }) {
  const own = OWN_PAGES.test(pathname);
  const community = !own && COMMUNITY_PAGES.test(pathname);
  return (
    <nav className={`site-tabs ${className}`} aria-label={strings.nav.site}>
      <Link className="site-tabs__tab" to="/b" aria-current={own ? "page" : undefined}>
        {strings.nav.boards}
      </Link>
      <Link className="site-tabs__tab" to="/" aria-current={community ? "page" : undefined}>
        {strings.sections.community}
      </Link>
    </nav>
  );
}

/**
 * The bar's field: starts with the words the page was asked for, and takes
 * new ones to the search page. It stays the same field when the words asked
 * change, so a search made from it keeps the focus in it.
 */
function BarSearch({ asked }: { asked: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(asked);
  const [shown, setShown] = useState(asked);
  if (shown !== asked) {
    setShown(asked);
    setQuery(asked);
  }
  const field = useRef<HTMLInputElement>(null);
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q !== "") void navigate(`/search?q=${encodeURIComponent(q)}`);
  };
  return (
    <form className="top__search" role="search" onSubmit={onSearch}>
      <Icon name="search" />
      <input
        ref={field}
        type="search"
        value={query}
        placeholder={strings.nav.search}
        aria-label={strings.nav.search}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
      />
      {query !== "" && (
        <ClearButton
          onClear={() => {
            setQuery("");
            field.current?.focus();
          }}
        />
      )}
    </form>
  );
}

/**
 * Where a page's scroll is kept. Every full load of the site starts at an
 * entry named "default", whatever the address, so a place kept under that
 * name would carry one page's scroll into the next page opened by its link.
 * A first entry is kept by its address instead.
 */
export const scrollKey = (location: Location): string =>
  location.key === "default" ? location.pathname : location.key;

function ScrollCatchUp() {
  useScrollCatchUp(scrollKey(useLocation()));
  return null;
}

/**
 * Focuses a landmark for the moment only. Kept focusable, it took the focus
 * of every click on something that is not a control (and in Safari a click
 * on a button is that too), so code that waits for the focus to fall to the
 * page never saw it fall.
 */
function focusForNow(element: HTMLElement | null) {
  if (element === null) return;
  element.setAttribute("tabindex", "-1");
  element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  element.focus({ preventScroll: true });
}

export function Shell() {
  const { account, signIn } = useSession();
  const [seen] = useState(() => lastSeen());
  // Nothing pressed here yet: a sign-in that came back from its redirect failed speaks instead.
  const [pressed, setSigning] = useState<"idle" | "busy" | "failed" | "inApp" | null>(null);
  const redirectFailed = useRedirectFailed();
  const signing = pressed ?? (redirectFailed ? "failed" : "idle");

  // On a phone the list's heading scrolls away under the tray's work; once it
  // has, the app bar says what the page is instead of the brand.
  const [page, setPage] = useState<PageName | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > TITLE_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const titled = page !== null && page.inBar && scrolled;
  useEffect(() => {
    document.title = documentTitleOf(page, strings.brand);
  }, [page]);

  // The bar's search box. The home page has its own, larger one, so the bar
  // goes without there; on the search page the box shows the words asked.
  const location = useLocation();
  // A page whose chunk is on its way keeps the old one up until it comes: a
  // line under the bar says the click was heard.
  const opening = useNavigation().state === "loading";

  // A new page takes the focus, so the keyboard starts on it rather than
  // wherever the old page's link was (often nowhere at all). A page that
  // took the focus itself keeps it, and so does the bar's search box.
  const main = useRef<HTMLElement>(null);
  const shownPath = useRef(location.pathname);
  useEffect(() => {
    if (shownPath.current === location.pathname) return;
    shownPath.current = location.pathname;
    const active = document.activeElement;
    const kept =
      active instanceof HTMLElement &&
      active !== document.body &&
      (main.current?.contains(active) === true ||
        active.closest("[aria-modal='true'], [role='search']") !== null);
    if (!kept) focusForNow(main.current);
  }, [location.pathname]);
  const [params] = useSearchParams();
  const home = location.pathname === "/";
  const asked = location.pathname === "/search" ? (params.get("q") ?? "") : "";

  // The browser would not keep something written: lists made now would be lost on the spot.
  const storageTrouble = useSyncExternalStore(
    subscribeToStorageTrouble,
    storageRefused,
    storageRefused,
  );

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
            {page?.title}
          </span>
        )}
        <SiteTabs className="top__tabs" pathname={location.pathname} />
        {!home && <BarSearch asked={asked} />}
        <nav className="top__actions" aria-label={strings.nav.site}>
          {!home && (
            <Link className="top__search-link" to="/search" aria-label={strings.nav.search}>
              <Icon name="search" />
            </Link>
          )}
          <Link className="btn btn--tonal top__make" to="/b/new" aria-label={strings.nav.newList}>
            <Icon name="add" className="btn__icon top__make-icon" />
            <span className="top__make-text">{strings.nav.newList}</span>
          </Link>
          {account?.kind === "signedIn" ? (
            <AccountMenu account={account} />
          ) : account === null && seen !== null ? (
            // Who was here last time, until Firebase says: Sign in flashed first.
            <span className="menu__button menu__button--face" aria-hidden="true">
              <FaceOf name={seen.displayName} photoUrl={seen.photoUrl} />
              <Icon name="expand_more" className="menu__chevron" />
            </span>
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
        {opening && (
          <span className="top__pending" role="progressbar" aria-label={strings.nav.opening} />
        )}
      </header>
      {/^\/(following|b)?$/.test(location.pathname) && (
        <SiteTabs className="site-tabs--row" pathname={location.pathname} />
      )}
      {signing === "inApp" && (
        <p className="top__banner" role="alert">
          {strings.keep.inApp}
        </p>
      )}
      {storageTrouble && (
        <p className="top__banner" role="alert">
          {strings.nav.storageRefused}
        </p>
      )}
      <main className="shell__main" ref={main}>
        <PageTitleContext.Provider value={setPage}>
          <Outlet />
        </PageTitleContext.Provider>
      </main>
      <footer className="foot">
        <a href="/privacy.html">{strings.footer.privacy}</a>
        <AppFooterLink />
        <Link to="/about">{strings.footer.about}</Link>
        {/* The theme is a setting a guest has too, and a guest has no account menu to find it in. */}
        <Link to="/settings">{strings.nav.settings}</Link>
      </footer>
      {/* A new page opens at its top, and Back returns to where the person was. */}
      <ScrollRestoration getKey={scrollKey} />
      <ScrollCatchUp />
    </div>
  );
}
