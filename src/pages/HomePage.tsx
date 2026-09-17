import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "../app/session";
import { localStorageStore } from "../features/board/draft";
import { CategoryTiles } from "../features/feed/CategoryTiles";
import { FeedGrid } from "../features/feed/FeedGrid";
import { keepFeedSource, readFeedSource, type FeedSource } from "../features/feed/feedSource";
import {
  FeedSourceSwitch,
  FollowingFeed,
  type Follow,
  type LoadSuggestions,
} from "../features/feed/Following";
import { SearchBox } from "../features/feed/SearchBox";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import { strings } from "../strings";
import "./HomePage.css";

/** The one line after an account is deleted stays this long. */
export const DELETED_NOTE_MS = 8000;

interface HomePageProps {
  load?: LoadFeed;
  loadSuggestions?: LoadSuggestions;
  follow?: Follow;
}

function SignedInFeed({
  uid,
  load,
  loadSuggestions,
  follow,
}: {
  uid: string;
  load: LoadFeed | undefined;
  loadSuggestions: LoadSuggestions | undefined;
  follow: Follow | undefined;
}) {
  const [source, setSource] = useState<FeedSource>(() =>
    readFeedSource(uid, (key) => localStorageStore.read(key)),
  );
  const popular = useFeed({ sort: "popular" }, load);
  const following = useFeed(
    source === "following" ? { following: true, sort: "recent" } : { sort: "popular" },
    load,
  );

  const choose = (next: FeedSource) => {
    setSource(next);
    keepFeedSource(uid, next, (key, value) => localStorageStore.write(key, value));
  };

  return (
    <>
      <FeedSourceSwitch source={source} onChange={choose} />
      <CategoryTiles />
      <section className="home__popular" aria-labelledby="popular">
        <div className="home__heading">
          <h2 id="popular">
            {source === "following" ? strings.home.followingHeading : strings.home.popular}
          </h2>
          <p>{source === "following" ? strings.home.newestFirst : strings.home.popularNote}</p>
        </div>
        {source === "following" ? (
          <FollowingFeed
            state={following.state}
            retry={following.retry}
            more={following.more}
            onSeeEveryone={() => choose("everyone")}
            loadSuggestions={loadSuggestions}
            follow={follow}
          />
        ) : (
          <FeedGrid
            state={popular.state}
            label={strings.home.popular}
            retry={popular.retry}
            more={popular.more}
            paged={false}
          />
        )}
      </section>
    </>
  );
}

function GuestFeed({ load }: { load: LoadFeed | undefined }) {
  const popular = useFeed({ sort: "popular" }, load);
  return (
    <>
      <CategoryTiles />
      <section className="home__popular" aria-labelledby="popular">
        <div className="home__heading">
          <h2 id="popular">{strings.home.popular}</h2>
          <p>{strings.home.popularNote}</p>
        </div>
        <FeedGrid
          state={popular.state}
          label={strings.home.popular}
          retry={popular.retry}
          more={popular.more}
          paged={false}
        />
      </section>
    </>
  );
}

export function HomePage({ load, loadSuggestions, follow }: HomePageProps) {
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

      {account?.kind === "signedIn" ? (
        <SignedInFeed
          key={account.uid}
          uid={account.uid}
          load={load}
          loadSuggestions={loadSuggestions}
          follow={follow}
        />
      ) : (
        <GuestFeed load={load} />
      )}
    </div>
  );
}
