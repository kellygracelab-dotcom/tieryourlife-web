import { MediaImage } from "../ui/MediaImage";
import { useBackCloses } from "../ui/useBackCloses";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
} from "react";
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
import { PHONE, useMedia } from "../features/play/media";
import { appIsLive, onApple, playUrl } from "../lib/links";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { lastSeen } from "../lib/signedInHint";
import { storageRefused, subscribeToStorageTrouble } from "../lib/storage";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { ClearButton } from "../ui/ClearButton";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { ScopeChip } from "../ui/ScopeChip";
import { sayOnTheSite, siteNotice, subscribeToSiteNotice } from "../ui/siteNotice";
import { SiteSnackbar } from "../ui/Snackbar";
import { documentTitleOf, PageTitleContext, TITLE_AFTER_PX, type PageName } from "./pageTitle";
import { useScrollCatchUp } from "./scrollCatchUp";
import {
  scopeKey,
  SEARCH_DEBOUNCE_MS,
  SearchScopeContext,
  searchPathOf,
  searchWordsIn,
  type SearchScope,
} from "./searchScope";
import { useRedirectFailed, useSession } from "./session";
import { signInFailedText } from "./signInFailure";
import { initialOf } from "../lib/initial";
import "./Shell.css";

/**
 * The app in the footer: a link once anyone can get it, plain words until
 * then, nothing on an iPhone. The words have a line of their own under the
 * links at every width, so they can say where the app is coming (Designer,
 * 25.11: the computer's foot is the phone's).
 */
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
    <MediaImage className="face" src={photoUrl} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="face face--initial">{initialOf(name)}</span>
  );
}

/**
 * Where a signed-in person's own things are, each row with its icon at the
 * start (artboard 25), and Sign out under a line at the end; Settings keeps
 * one too. Drawn from who was here last time until Firebase says, so a press
 * before then opens it too; Admin waits for the account.
 */
function AccountMenu({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const { account, signOut } = useSession();
  const moderator = useModerator();
  const waiting = useAdminCounts(
    moderator.status === "yes" && account?.kind === "signedIn" ? account.uid : null,
    moderator.status === "yes" ? moderator.reports.length : 0,
  );
  return (
    <Menu
      label={strings.nav.account}
      buttonClassName="menu__button menu__button--face"
      button={
        <>
          <FaceOf name={name} photoUrl={photoUrl} />
          <Icon name="expand_more" className="menu__chevron" />
        </>
      }
    >
      <>
        <li className="menu__who">{name ?? strings.nav.you}</li>
        <li>
          <Link to="/b" className="menu__row">
            <Icon name="view_list" />
            <span>{strings.nav.boards}</span>
          </Link>
        </li>
        {appIsLive() && !onApple() && (
          <li>
            <a href={playUrl("menu")} target="_blank" rel="noopener" className="menu__row">
              <Icon name="install_mobile" />
              <span>{strings.android.menu}</span>
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
          <Link to="/settings" className="menu__row">
            <Icon name="settings" />
            <span>{strings.nav.settings}</span>
          </Link>
        </li>
        <li className="menu__divider" role="separator" />
        <li>
          <button type="button" className="menu__action menu__row" onClick={() => void signOut()}>
            <Icon name="logout" />
            <span>{strings.nav.signOut}</span>
          </button>
        </li>
      </>
    </Menu>
  );
}

/** Where each of the app's two tabs is "here": your own lists, or everybody's. */
const OWN_PAGES = /^\/(b|trash)(\/|$)/;
const COMMUNITY_PAGES = /^\/(following|s|search|l|u|r)?(\/|$)/;

/**
 * The app's two places, Your lists and Community, as tabs in the bar: from
 * 600 on every page, and on a phone on the pages they lead to, where they
 * take the brand's place (one bar of 56 px, as the app has it, 25.11.2026).
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
 * change, so a search made from it keeps the focus in it. On a section's or
 * a topic's page it looks there first, as the app does: a chip says where,
 * and its cross (or Backspace in the empty field) lets it look everywhere.
 *
 * The results follow the typing (walkthrough item 6, Danylo, 25.11): once it
 * pauses, the words go to the search page, a step Back returns from when they
 * leave another page, and in place of the last words once on the search page,
 * so Back does not walk through every pause. Enter goes at once. Words that
 * would not change what the page asks are not sent: no second request.
 */
function BarSearch({ asked, scope }: { asked: string; scope: SearchScope | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState(asked);
  const [shown, setShown] = useState(asked);
  // The words the field last sent after a pause. They come back as the
  // address's, trimmed, while the person may have typed on (a space, a letter
  // more): those are kept, not put back to what was sent.
  const [sent, setSent] = useState<string | null>(null);
  if (shown !== asked) {
    setShown(asked);
    setSent(null);
    if (asked !== sent && asked !== query.trim()) setQuery(asked);
  }
  // A place given up stays given up while the page is about it; another
  // place, or the same one opened again, brings the chip back.
  const key = scopeKey(scope);
  const [placeKey, setPlaceKey] = useState(key);
  const [dropped, setDropped] = useState(false);
  if (placeKey !== key) {
    setPlaceKey(key);
    setDropped(false);
  }
  const place = dropped ? null : scope;
  const field = useRef<HTMLInputElement>(null);
  const onSearchPage = location.pathname === "/search";
  // On the search page the words change and the rest it asks stays; from
  // anywhere else they open it, in the place the chip says.
  const pathOf = (q: string) =>
    onSearchPage ? searchWordsIn(q, location.search) : searchPathOf(q, place);
  // The pause reads the address and the place as they are when it ends.
  const pathFor = useRef(pathOf);
  useEffect(() => {
    pathFor.current = pathOf;
  });
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The page the words were typed on. A link followed during the pause is
  // where the person went: the words do not take them on from there.
  const typedOn = useRef(location.pathname);
  const type = (words: string) => {
    typedOn.current = location.pathname;
    setQuery(words);
  };
  const here = location.pathname;
  useEffect(() => {
    const q = query.trim();
    if (typedOn.current !== here) return;
    // The same words as the page has, or none away from the search page: nothing to ask.
    if (q === asked.trim() || (!onSearchPage && q === "")) return;
    const timer = setTimeout(() => {
      setSent(q);
      void navigate(pathFor.current(q), { replace: onSearchPage });
    }, SEARCH_DEBOUNCE_MS);
    pause.current = timer;
    return () => clearTimeout(timer);
  }, [query, asked, here, onSearchPage, navigate]);
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    clearTimeout(pause.current);
    const q = query.trim();
    if (q === "") return;
    setQuery(q);
    const path = pathOf(q);
    // The same words again are the same page: Back should not need two presses.
    const same = location.pathname + location.search === path;
    void navigate(path, { replace: same });
  };
  const everywhere = () => {
    field.current?.focus();
    if (location.pathname !== "/search") {
      setDropped(true);
      return;
    }
    // The search page's own place: what it shows goes everywhere at once.
    const params = new URLSearchParams(location.search);
    params.delete("category");
    params.delete("topic");
    const rest = params.toString();
    void navigate(rest === "" ? "/search" : `/search?${rest}`, { replace: true });
  };
  return (
    <form className="top__search" role="search" onSubmit={onSearch}>
      <Icon name="search" />
      {place !== null && <ScopeChip name={place.name} onClear={everywhere} />}
      <input
        ref={field}
        type="search"
        value={query}
        placeholder={strings.nav.search}
        aria-label={
          place === null ? strings.nav.search : fill(strings.nav.searchIn, { place: place.name })
        }
        autoComplete="off"
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Backspace" || query !== "" || place === null) return;
          event.preventDefault();
          everywhere();
        }}
      />
      {query !== "" && (
        <ClearButton
          onClear={() => {
            type("");
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

const clearSiteNotice = () => sayOnTheSite(null);

function ShellBackGuard() {
  useBackCloses(false, () => {});
  return null;
}
/** A list's own page: a board of one's own, a published list, a ranking. */
const LIST_PAGES = /^\/(b|l|r)\/[^/]+/;
/**
 * One's own list: on a phone it has a one-row head of its own and no site bar
 * (artboard 18). Said by a class from here, where the route is known.
 */
const OWN_LIST = /^\/b\/(?!new$)[^/]+$/;

/**
 * The pages the two tabs lead to: Community (with Following) and Your lists.
 * On a phone their bar is the tabs themselves, and New list is a round button
 * at the window's lower corner, as on the app's home screens.
 */
const TAB_PAGES = /^\/(following|b)?$/;

/**
 * Where a phone offers a new list: the tabs' pages and the pages that browse
 * lists, sections, topics, search and a profile. New list lives in one place
 * there, the round button at the corner; the bar's plus is gone on a phone
 * (walkthrough item 10, Danylo, 25.11). A list's page is left out: its tray
 * docks at the bottom of a phone, where the button would sit over the cards.
 */
const NEW_LIST_PAGES = /^\/((following|b|s|search)?|s\/[^/]+(\/t\/[^/]+)?|u\/[^/]+)$/;

/** Below this the bar always shows: the page's top is where it is. */
const AWAY_AFTER_PX = 120;

/** A scroll smaller than this is a hand resting on the glass, not a direction. */
const SCROLL_NOISE_PX = 4;

/**
 * On a list's page in a narrow window, the bar goes up out of the way as the
 * page scrolls down and comes back as soon as it scrolls up (audit C2): the
 * board is what the screen is for. A wide window has room for both. The tabs'
 * pages do the same on a phone, as the app's home screens do (25.11.2026).
 * `query` is the width it happens below, or null where it never does.
 */
function useAwayOnScroll(query: string | null): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (query === null || typeof window.matchMedia !== "function") return;
    const narrow = window.matchMedia(query);
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (!narrow.matches || y < AWAY_AFTER_PX) setAway(false);
      else if (y > last + SCROLL_NOISE_PX) setAway(true);
      else if (y < last - SCROLL_NOISE_PX) setAway(false);
      else return;
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      // Off the page the bar is back, and back again on the next one.
      setAway(false);
    };
  }, [query]);
  return query !== null && away;
}

export function Shell() {
  const { account, signIn } = useSession();
  const [seen] = useState(() => lastSeen());
  const location = useLocation();
  const [signing, setSigning] = useState(false);
  // What the last press of Sign in came to, said under the bar on the page it
  // was pressed on and gone from the next. Nothing pressed here yet: a sign-in
  // that came back from its redirect failed speaks instead, on the page it
  // came back to.
  // The note is the failure's code, said by its reason: a blocked Google
  // window names the way out (Danylo, 25.11).
  const [said, setSaid] = useState<{ note: string | null; on: string } | null>(null);
  const [landedOn] = useState(location.pathname);
  const redirectFailed = useRedirectFailed();
  const told = said ?? (redirectFailed ? { note: "redirect-failed", on: landedOn } : null);
  const note = told !== null && told.on === location.pathname ? told.note : null;

  // On a phone the list's heading scrolls away under the tray's work; once it
  // has, the app bar says what the page is instead of the brand.
  const [page, setPage] = useState<PageName | null>(null);
  // Where the page's searches start: its section or topic, or anywhere.
  const [scope, setScope] = useState<SearchScope | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > TITLE_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const titled = page !== null && page.inBar && scrolled;
  const tabsPage = TAB_PAGES.test(location.pathname);
  const away = useAwayOnScroll(
    LIST_PAGES.test(location.pathname) ? "(max-width: 839px)" : tabsPage ? PHONE : null,
  );
  const ownList = OWN_LIST.test(location.pathname);
  // What a phone's bar and foot hold, not only how they are drawn: the round
  // New list button, and the foot's shorter and longer words.
  const phone = useMedia(PHONE);
  const fab = phone && NEW_LIST_PAGES.test(location.pathname);
  useEffect(() => {
    document.title = documentTitleOf(page, strings.brand);
  }, [page]);

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
  // The bar's search box. The home page has its own, larger one, so the bar
  // goes without there; on the search page the box shows the words asked.
  const [params] = useSearchParams();
  // Both of the home page's tabs carry its large box.
  const home = location.pathname === "/" || location.pathname === "/following";
  const asked = location.pathname === "/search" ? (params.get("q") ?? "") : "";

  // The browser would not keep something written: lists made now would be lost on the spot.
  const storageTrouble = useSyncExternalStore(
    subscribeToStorageTrouble,
    storageRefused,
    storageRefused,
  );
  // What a page that was left meanwhile had to say: a report that did not go through.
  const outlived = useSyncExternalStore(subscribeToSiteNotice, siteNotice, siteNotice);

  const onSignIn = () => {
    const on = location.pathname;
    setSigning(true);
    setSaid({ note: null, on });
    signIn()
      .then(
        (outcome) => (outcome.kind !== "failed" ? null : outcome.code),
        // Nothing that goes wrong may leave Sign in greyed out for good.
        () => "unknown",
      )
      .then((next) => {
        setSaid({ note: next, on });
        setSigning(false);
      });
  };

  // Past the bar to the page, for the keyboard: the bar is six stops long.
  const skipToMain = (event: MouseEvent) => {
    event.preventDefault();
    focusForNow(main.current);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={skipToMain}>
        {strings.nav.skipToContent}
      </a>
      <header
        className={[
          "top",
          titled && "top--titled",
          away && "top--away",
          ownList && "top--own-list",
          tabsPage && "top--tabs",
        ]
          .filter(Boolean)
          .join(" ")}
      >
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
        {!home && <BarSearch asked={asked} scope={scope} />}
        {/* Not a second navigation: what is here acts rather than leads somewhere. */}
        <div className="top__actions">
          {/* The home page's own box is its search, but scrolls away with it: on a phone the bar's icon stays at hand. */}
          {(!home || phone) && (
            <Link
              className="top__search-link"
              to={searchPathOf("", scope)}
              aria-label={
                scope === null
                  ? strings.nav.search
                  : fill(strings.nav.searchIn, { place: scope.name })
              }
            >
              <Icon name="search" />
            </Link>
          )}
          {/* Not on a phone: there New list is the round button alone (walkthrough item 10, Danylo, 25.11). */}
          {!phone && (
            <Link className="btn btn--tonal top__make" to="/b/new" aria-label={strings.nav.newList}>
              <Icon name="add" className="btn__icon top__make-icon" />
              <span className="top__make-text">{strings.nav.newList}</span>
            </Link>
          )}
          {account?.kind === "signedIn" ? (
            <AccountMenu name={account.displayName} photoUrl={account.photoUrl} />
          ) : account === null && seen !== null ? (
            // Who was here last time, until Firebase says: Sign in flashed first.
            <AccountMenu name={seen.displayName} photoUrl={seen.photoUrl} />
          ) : (
            // On the tabs' pages of a phone only the person icon shows; the words still name it.
            <Button className="top__sign-in" icon="person" onClick={onSignIn} disabled={signing}>
              {strings.nav.signIn}
            </Button>
          )}
        </div>
        {opening && (
          <span className="top__pending" role="progressbar" aria-label={strings.nav.opening} />
        )}
      </header>
      {/* Under the bar, not in it: there a phone's buttons were squeezed off the screen. */}
      {note !== null && (
        <p
          className={note === IN_APP_BROWSER ? "top__banner" : "top__banner top__banner--error"}
          role="alert"
        >
          {signInFailedText(note)}
        </p>
      )}
      {storageTrouble && (
        <p className="top__banner" role="alert">
          {strings.nav.storageRefused}
        </p>
      )}
      <main
        id="main"
        className={ownList ? "shell__main shell__main--own-list" : "shell__main"}
        ref={main}
      >
        <PageTitleContext.Provider value={setPage}>
          <SearchScopeContext.Provider value={setScope}>
            <Outlet />
          </SearchScopeContext.Provider>
        </PageTitleContext.Provider>
      </main>
      {/* New list on a phone: the app's round button (25.11.2026), on every page that offers one. */}
      {fab && (
        <Link className="fab" to="/b/new" aria-label={strings.nav.newList}>
          <Icon name="add" />
        </Link>
      )}
      <footer className={fab ? "foot foot--fab" : "foot"}>
        <a href="/privacy.html">{strings.footer.privacyShort}</a>
        <AppFooterLink />
        <Link to="/about">{strings.footer.about}</Link>
        {/* The theme is a setting a guest has too, and a guest has no account menu to find it in. */}
        <Link to="/settings">{strings.nav.settings}</Link>
      </footer>
      {/* A new page opens at its top, and Back returns to where the person was. */}
      <ScrollRestoration getKey={scrollKey} />
      <ScrollCatchUp />
      {/* Board and list pages also handle Play. Section editors own their unsaved-change guard. */}
      {(location.pathname === "/b/new" ||
        !/^\/(b\/|l\/|admin(?:\/|$)|s$)/.test(location.pathname)) && <ShellBackGuard />}
      <SiteSnackbar notice={outlived} onDone={clearSiteNotice} />
    </div>
  );
}
