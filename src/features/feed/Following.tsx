import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { SuggestedAuthor } from "../../api/community";
import { useSession } from "../../app/session";
import { followAuthor, suggestedAuthors } from "../../lib/api";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useResource } from "../list/useResource";
import { FollowButton } from "../community/FollowButton";
import { FeedGrid } from "./FeedGrid";
import type { FeedState } from "./useFeed";
import { type FeedSource } from "./feedSource";
import "./following.css";

/** Everyone or Following: two radios that look like one pill. */
export function FeedSourceSwitch({
  source,
  onChange,
}: {
  source: FeedSource;
  onChange: (source: FeedSource) => void;
}) {
  const options: { id: FeedSource; text: string }[] = [
    { id: "everyone", text: strings.home.everyone },
    { id: "following", text: strings.home.following },
  ];
  return (
    <div className="theme feed-source" role="radiogroup" aria-label={strings.home.source}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={source === option.id}
          className="theme__option"
          onClick={() => onChange(option.id)}
        >
          {source === option.id && <Icon name="check" className="theme__check" />}
          {option.text}
        </button>
      ))}
    </div>
  );
}

export type LoadSuggestions = () => Promise<{ authors: SuggestedAuthor[] }>;
export type Follow = (authorUid: string) => Promise<unknown>;

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

function SuggestionCard({ author, follow }: { author: SuggestedAuthor; follow: Follow }) {
  const [state, setState] = useState<"idle" | "following" | "failed">("idle");
  const onFollow = () => {
    setState("following");
    follow(author.uid).catch(() => setState("failed"));
  };
  return (
    <li className="suggestion">
      <Link
        className="suggestion__who"
        to={`/u/${encodeURIComponent(author.uid)}`}
        state={{ author: { name: author.name, photoUrl: author.photoUrl } }}
      >
        {author.photoUrl !== null ? (
          <img className="suggestion__face" src={author.photoUrl} alt="" loading="lazy" />
        ) : (
          <span className="suggestion__face suggestion__face--initial" aria-hidden="true">
            {initialOf(author.name)}
          </span>
        )}
        <span className="suggestion__name">{author.name.trim() || strings.profile.someone}</span>
        <span className="suggestion__meta">{plural(strings.card.rankings, author.takeCount)}</span>
      </Link>
      <FollowButton following={state === "following"} onClick={onFollow} size="card" />
      {state === "failed" && (
        <p className="follow__failed" role="alert">
          <Icon name="cloud_off" />
          {strings.follow.failed}
        </p>
      )}
    </li>
  );
}

/** Authors worth following, when the person follows nobody yet. */
export function Suggestions({
  uid,
  load = suggestedAuthors,
  follow = followAuthor,
}: {
  uid: string;
  load?: LoadSuggestions;
  follow?: Follow;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  if (state.status !== "ready" || state.value.authors.length === 0) return null;
  return (
    <section className="suggestions" aria-labelledby="suggestions-title">
      <h3 id="suggestions-title" className="suggestions__title">
        {strings.home.worthFollowing}
      </h3>
      <ul className="suggestions__grid">
        {state.value.authors.map((author) => (
          <SuggestionCard key={author.uid} author={author} follow={follow} />
        ))}
      </ul>
    </section>
  );
}

/** The Following feed with its own empty states; the grid itself is the usual one. */
export function FollowingFeed({
  state,
  retry,
  more,
  onSeeEveryone,
  loadSuggestions,
  follow,
}: {
  state: FeedState;
  retry: () => void;
  more: () => void;
  onSeeEveryone: () => void;
  loadSuggestions?: LoadSuggestions;
  follow?: Follow;
}) {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : "";
  if (state.status === "error") {
    return (
      <div className="feed__trouble" role="alert">
        <p>{strings.home.followingFailed}</p>
        <Button variant="tonal" icon="refresh" onClick={retry}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }
  if (state.status === "ready" && state.followingNobody) {
    return (
      <>
        <div className="following-empty">
          <Icon name="group" className="following-empty__icon" />
          <p className="following-empty__title">{strings.home.followingNobody}</p>
          <p className="following-empty__body">{strings.home.followingNobodyBody}</p>
        </div>
        <Suggestions uid={uid} load={loadSuggestions} follow={follow} />
      </>
    );
  }
  if (state.status === "ready" && state.lists.length === 0) {
    return (
      <div className="following-empty">
        <p className="following-empty__body">{strings.home.followingNothing}</p>
        <Button onClick={onSeeEveryone}>{fill(strings.home.seeEveryone, {})}</Button>
      </div>
    );
  }
  return <FeedGrid state={state} label={strings.home.followingHeading} retry={retry} more={more} />;
}
