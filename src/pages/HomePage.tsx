import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useSession } from "../app/session";
import { AppCard } from "../features/android/AppCard";
import { FeedGrid } from "../features/feed/FeedGrid";
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
  store,
}: {
  load: LoadFeed | undefined;
  store: SectionsStore | undefined;
}) {
  const popular = useFeed({ sort: "popular" }, load);
  const { sections, known } = useSections(store);
  return (
    <>
      <SectionGrid sections={sections} known={known} />
      <section className="home__popular" aria-labelledby="popular">
        <div className="home__heading">
          <h2 id="popular">{strings.sections.popularThisWeek}</h2>
          <p>{strings.home.popularNote}</p>
        </div>
        <FeedGrid
          state={popular.state}
          label={strings.sections.popularThisWeek}
          retry={popular.retry}
          more={popular.more}
          paged={false}
        />
      </section>
    </>
  );
}

export function HomePage({
  tab = "explore",
  load,
  loadSuggestions,
  loadFollowing,
  follow,
  unfollow,
  store,
}: HomePageProps) {
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
      {/* The app card comes first, above the hero, so everyone sees it at once. */}
      <AppCard slot="home" />
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
        <Explore load={load} store={store} />
      )}
    </div>
  );
}
