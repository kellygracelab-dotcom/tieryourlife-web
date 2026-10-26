import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { FollowedAuthor, SuggestedAuthor } from "../../api/community";
import { useSession } from "../../app/session";
import { followAuthor, loadFollowing, suggestedAuthors, unfollowAuthor } from "../../lib/api";
import { isEditorialAuthor } from "../../lib/editorial";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import { Icon } from "../../ui/Icon";
import { useResource } from "../../lib/useResource";
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

/** A person's picture, or their initial in a circle when they have none. */
function Face({
  author,
  className = "suggestion__face",
}: {
  author: { name: string; photoUrl: string | null };
  className?: string;
}) {
  return author.photoUrl !== null ? (
    <img className={className} src={author.photoUrl} alt="" loading="lazy" />
  ) : (
    <span className={`${className} suggestion__face--initial`} aria-hidden="true">
      {initialOf(author.name)}
    </span>
  );
}

function SuggestionCard({
  author,
  follow,
  unfollow,
}: {
  author: SuggestedAuthor;
  follow: Follow;
  unfollow: Follow;
}) {
  const [state, setState] = useState<"idle" | "following" | "failed">("idle");
  const toggle = () => {
    if (state === "following") {
      setState("idle");
      unfollow(author.uid).catch(() => setState("following"));
    } else {
      setState("following");
      follow(author.uid).catch(() => setState("failed"));
    }
  };
  return (
    <li className="suggestion">
      <Link
        className="suggestion__who"
        to={`/u/${encodeURIComponent(author.uid)}`}
        state={{ author: { name: author.name, photoUrl: author.photoUrl } }}
      >
        <Face author={author} />
        <span className="suggestion__name">{author.name.trim() || strings.profile.someone}</span>
        <span className="suggestion__meta">{plural(strings.card.rankings, author.takeCount)}</span>
      </Link>
      <FollowButton following={state === "following"} onClick={toggle} size="card" />
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
  unfollow = unfollowAuthor,
}: {
  uid: string;
  load?: LoadSuggestions;
  follow?: Follow;
  unfollow?: Follow;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  // An editorial account is nobody to follow: its lists stand without an author.
  const authors =
    state.status === "ready"
      ? state.value.authors.filter((author) => !isEditorialAuthor(author.uid))
      : [];
  if (authors.length === 0) return null;
  return (
    <section className="suggestions" aria-labelledby="suggestions-title">
      <h3 id="suggestions-title" className="suggestions__title">
        {strings.home.worthFollowing}
      </h3>
      <ul className="suggestions__grid">
        {authors.map((author) => (
          <SuggestionCard key={author.uid} author={author} follow={follow} unfollow={unfollow} />
        ))}
      </ul>
    </section>
  );
}

export type LoadFollowing = () => Promise<{ authors: FollowedAuthor[] }>;

/** How many faces the strip shows; the list behind Manage has everyone. */
export const FACES_SHOWN = 8;

/**
 * The people somebody follows, with Unfollow beside each. Unfollowing takes
 * the row away at once and brings it back, with a word, if it did not take.
 */
function ManageFollowing({
  authors,
  unfollow,
  onClose,
}: {
  authors: readonly FollowedAuthor[];
  unfollow: Follow;
  /** The uids the account confirmed as unfollowed while the list was open. */
  onClose: (unfollowed: readonly string[]) => void;
}) {
  const [people, setPeople] = useState<readonly FollowedAuthor[]>(authors);
  const [failed, setFailed] = useState<string | null>(null);
  const [unfollowed, setUnfollowed] = useState<readonly string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(unfollowed), [onClose, unfollowed]);

  useModal(box, close, "button");

  const drop = (person: FollowedAuthor) => {
    setFailed(null);
    setPeople((current) => current.filter((one) => one.uid !== person.uid));
    unfollow(person.uid).then(
      () => setUnfollowed((done) => [...done, person.uid]),
      () => {
        setPeople((current) =>
          authors.filter((one) => one.uid === person.uid || current.includes(one)),
        );
        setFailed(person.uid);
      },
    );
  };

  return createPortal(
    <div className="scrim" onClick={close}>
      <div
        ref={box}
        className="dialog manage-following"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-following-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="manage-following-title" className="dialog__title">
          {strings.home.following}
        </h2>
        {people.length === 0 ? (
          <p className="dialog__body">{strings.home.followingNobody}</p>
        ) : (
          <ul className="manage-following__list">
            {people.map((person) => (
              <li key={person.uid} className="manage-following__row">
                <Link
                  className="manage-following__who"
                  to={`/u/${encodeURIComponent(person.uid)}`}
                  state={{ author: { name: person.name, photoUrl: person.photoUrl } }}
                >
                  <Face author={person} className="manage-following__face" />
                  <span className="manage-following__name">
                    {person.name.trim() || strings.profile.someone}
                  </span>
                </Link>
                <Button variant="tonal" onClick={() => drop(person)}>
                  {strings.follow.unfollow}
                </Button>
                {failed === person.uid && (
                  <p className="follow__failed manage-following__failed" role="alert">
                    <Icon name="cloud_off" />
                    {strings.follow.failed}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog__actions">
          <Button onClick={close}>{strings.boards.done}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Who the following feed is made of, above it: a row of faces and the way to
 * the list that unfollows. The faces are a reminder, not buttons; the list is
 * where a person is acted on. Shown only once the people are known.
 */
export function FollowedStrip({
  uid,
  load = loadFollowing,
  unfollow = unfollowAuthor,
  onChanged,
}: {
  uid: string;
  load?: LoadFollowing;
  unfollow?: Follow;
  /** Somebody was unfollowed: the feed behind the strip is stale. */
  onChanged: () => void;
}) {
  const loadFor = useCallback(() => load(), [load]);
  const { state } = useResource(uid, loadFor);
  const [managing, setManaging] = useState(false);
  // Whoever the account confirmed as unfollowed leaves the strip at once. The
  // list is not read again for it: a reload would take the strip, and with it
  // the Manage button the focus goes back to, off the page for a moment.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  if (state.status !== "ready") return null;
  const authors = state.value.authors.filter((person) => !gone.has(person.uid));
  if (authors.length === 0) return null;
  return (
    <div className="followed">
      <div className="followed__line">
        <p className="followed__count">{plural(strings.home.youFollow, authors.length)}</p>
        <Button onClick={() => setManaging(true)}>{strings.home.manageFollowing}</Button>
      </div>
      <ul className="followed__faces" aria-hidden="true">
        {authors.slice(0, FACES_SHOWN).map((person) => (
          <li key={person.uid}>
            <Face author={person} className="followed__face" />
          </li>
        ))}
      </ul>
      {managing && (
        <ManageFollowing
          authors={authors}
          unfollow={unfollow}
          onClose={(unfollowed) => {
            setManaging(false);
            if (unfollowed.length > 0) {
              setGone((before) => new Set([...before, ...unfollowed]));
              onChanged();
            }
          }}
        />
      )}
    </div>
  );
}

/** The Following feed with its own empty states; the grid itself is the usual one. */
export function FollowingFeed({
  state,
  retry,
  more,
  onSeeEveryone,
  loadSuggestions,
  loadFollowing: loadPeople,
  follow,
  unfollow,
}: {
  state: FeedState;
  retry: () => void;
  more: () => void;
  onSeeEveryone: () => void;
  loadSuggestions?: LoadSuggestions;
  loadFollowing?: LoadFollowing;
  follow?: Follow;
  unfollow?: Follow;
}) {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : "";
  // The people behind the feed. It stays while the feed is read again after
  // an unfollow, so the strip, and the focus on its Manage button, do not
  // blink away; it goes only when the feed says nobody is followed.
  const strip = !(state.status === "ready" && state.followingNobody) && (
    <FollowedStrip uid={uid} load={loadPeople} unfollow={unfollow} onChanged={retry} />
  );
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
        <Suggestions uid={uid} load={loadSuggestions} follow={follow} unfollow={unfollow} />
      </>
    );
  }
  if (state.status === "ready" && state.lists.length === 0) {
    return (
      <>
        {strip}
        <div className="following-empty">
          <p className="following-empty__body">{strings.home.followingNothing}</p>
          <Button onClick={onSeeEveryone}>{fill(strings.home.seeEveryone, {})}</Button>
        </div>
      </>
    );
  }
  return (
    <>
      {strip}
      <FeedGrid state={state} label={strings.home.followingHeading} retry={retry} more={more} />
    </>
  );
}
