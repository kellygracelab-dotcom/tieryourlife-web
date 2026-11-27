import { useEffect, useMemo, useState } from "react";
import { usePageTitle } from "../app/pageTitle";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useSession } from "../app/session";
import { AppCard } from "../features/android/AppCard";
import { FeedGrid } from "../features/feed/FeedGrid";
import {
  freshOnTop,
  useFresh,
  useFreshIds,
  withFreshOnTop,
  type LoadFresh,
} from "../features/feed/fresh";
import { keepPlaces, useFirstScreen } from "../features/feed/firstScreen";
import { useHidden } from "../features/community/useHidden";
import {
  FollowingTab,
  type Follow,
  type LoadFollowing,
  type LoadSuggestions,
} from "../features/feed/Following";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import { FOLLOWING_PATH } from "../features/sections/model";
import { SectionGrid } from "../features/sections/SectionGrid";
import { useSections, type SectionsStore } from "../features/sections/useSections";
import { loadFresh as siteFresh } from "../lib/api";
import { wasSignedIn } from "../lib/signedInHint";
import { strings } from "../strings";
import { Spinner } from "../ui/Spinner";
import "./HomePage.css";

/** The one line after an account is deleted stays this long. */
export const DELETED_NOTE_MS = 8000;

export type HomeTab = "explore" | "following";

interface HomePageProps {
  tab?: HomeTab;
  load?: LoadFeed;
  /** People's newest lists, first in Popular with "New"; the site's own unless told otherwise. */
  loadFresh?: LoadFresh;
  loadSuggestions?: LoadSuggestions;
  loadFollowing?: LoadFollowing;
  follow?: Follow;
  unfollow?: Follow;
  store?: SectionsStore;
}

/** Explore and Following, the app's two tabs, each at an address of its own. */
function HomeTabs({ tab }: { tab: HomeTab }) {
  const tabs: { id: HomeTab; to: string; text: string }[] = [
    { id: "explore", to: "/", text: strings.sections.tabExplore },
    { id: "following", to: FOLLOWING_PATH, text: strings.sections.tabFollowing },
  ];
  return (
    <nav className="home-tabs" aria-label={strings.sections.community}>
      {tabs.map((one) => (
        <Link
          key={one.id}
          className="home-tabs__tab"
          to={one.to}
          aria-current={tab === one.id ? "page" : undefined}
        >
          {one.text}
        </Link>
      ))}
    </nav>
  );
}

function Explore({
  load,
  loadFresh,
  store,
  signedIn,
}: {
  load: LoadFeed | undefined;
  loadFresh: LoadFresh;
  store: SectionsStore | undefined;
  /** Somebody signed in, or by this device's last word about to be. */
  signedIn: boolean;
}) {
  // Drawn at once in a browser new to the site, until the live answers come.
  const first = useFirstScreen();
  const popular = useFeed({ sort: "popular" }, load, undefined, undefined, first?.popular ?? null);
  const live = useSections(store);
  const standIn = live.known ? null : (first?.sections ?? null);
  const sections = standIn ?? live.sections;
  const known = live.known || standIn !== null;
  const { hidden, hiddenThisVisit } = useHidden();
  const fresh = useFresh(loadFresh, undefined, first?.fresh ?? null);
  const top = useMemo(
    () => freshOnTop(fresh, hidden, hiddenThisVisit),
    [fresh, hidden, hiddenThisVisit],
  );
  const freshIds = useFreshIds(top);
  const shown = withFreshOnTop(popular.state, top);
  // The places the first screen gave its cards, once it is drawn: they keep them.
  const [placed, setPlaced] = useState<readonly string[] | null>(null);
  if (placed === null && popular.standingIn && shown.status === "ready") {
    setPlaced(shown.lists.map((list) => list.id));
  }
  const state =
    placed !== null && shown.status === "ready"
      ? { ...shown, lists: keepPlaces(placed, shown.lists) }
      : shown;
  return (
    <>
      <SectionGrid sections={sections} known={known} />
      <section className="home__popular" aria-labelledby="popular">
        <div className="home__heading">
          <h2 id="popular">{strings.sections.popular}</h2>
          {/* "No account needed" is for a guest; signed in it says nothing (Danylo's walk, 25.11). */}
          <p>{signedIn ? strings.home.popularNoteSignedIn : strings.home.popularNote}</p>
        </div>
        <FeedGrid
          state={state}
          freshIds={freshIds}
          label={strings.sections.popular}
          retry={popular.retry}
          more={popular.more}
        />
      </section>
    </>
  );
}

export function HomePage({
  tab = "explore",
  load,
  loadFresh = siteFresh,
  loadSuggestions,
  loadFollowing,
  follow,
  unfollow,
  store,
}: HomePageProps) {
  usePageTitle(tab === "following" ? strings.sections.tabFollowing : null, { inBar: false });
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const { account } = useSession();
  const arrivedAfterDeletion =
    (location.state as { accountDeleted?: boolean } | null)?.accountDeleted === true;
  const [deletedNote, setDeletedNote] = useState(arrivedAfterDeletion);

  useEffect(() => {
    if (!deletedNote) return;
    const timer = setTimeout(() => setDeletedNote(false), DELETED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [deletedNote]);

  const signedIn = account?.kind === "signedIn";
  // Following is somebody's own: a guest has nothing to follow with yet.
  if (tab === "following" && account !== null && !signedIn) return <Navigate to="/" replace />;
  // Until Firebase says who is here, the tabs stand on this device's last word.
  const tabs = signedIn || (account === null && wasSignedIn());

  return (
    <div className="home">
      {deletedNote && (
        <p className="home__notice" role="status">
          {strings.settings.deleted}
        </p>
      )}
      <section className="home__intro">
        <h1 className="home__hero">{strings.home.hero}</h1>
        <SearchBox
          value={query}
          onChange={setQuery}
          onSubmit={(q) => void navigate(`/search?q=${encodeURIComponent(q)}`)}
        />
      </section>

      {tabs && <HomeTabs tab={tab} />}
      {tab === "following" && account === null ? (
        <Spinner className="home__waiting" label={strings.sections.tabFollowing} />
      ) : tab === "following" && signedIn ? (
        <FollowingTab
          key={account.uid}
          uid={account.uid}
          load={load}
          loadFollowing={loadFollowing}
          loadSuggestions={loadSuggestions}
          follow={follow}
          unfollow={unfollow}
          store={store}
        />
      ) : (
        <>
          <Explore load={load} loadFresh={loadFresh} store={store} signedIn={tabs} />
          {/*
           * The app card after the lists, small: the first screen is for a board
           * one can open, a phone's too, not for an app that is not out yet.
           * Explore's only: under Following's late lists it would jump.
           */}
          <AppCard slot="home" />
        </>
      )}
    </div>
  );
}
