import { useCallback, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useSession } from "../app/session";
import { FollowButton } from "../features/community/FollowButton";
import { isAuthorHidden } from "../features/community/hidden";
import { SignInDialog } from "../features/community/SignInDialog";
import { useFollow, type FollowDeps } from "../features/community/useFollow";
import { useHidden } from "../features/community/useHidden";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./ProfilePage.css";

/** What a link to a profile may carry along, so the head is drawn before any answer. */
export interface AuthorHint {
  name: string;
  photoUrl: string | null;
}

interface ProfilePageProps {
  load?: LoadFeed;
  follow?: FollowDeps;
}

const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

type Asking = "closed" | "open" | "busy";

export function ProfilePage({ load, follow }: ProfilePageProps) {
  const { uid = "" } = useParams();
  const location = useLocation();
  const hint = (location.state as { author?: AuthorHint } | null)?.author ?? null;
  const { account, signIn } = useSession();
  const feed = useFeed({ author: uid, sort: "recent" }, load);
  const following = useFollow(uid, follow);
  const { hidden, showAuthor } = useHidden();
  const [asking, setAsking] = useState<Asking>("closed");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const lists = feed.state.status === "ready" ? feed.state.lists : [];
  const first = lists[0];
  const name = hint?.name ?? first?.authorName ?? strings.profile.someone;
  const photoUrl = hint?.photoUrl ?? first?.authorPhotoUrl ?? null;
  const own = account?.kind === "signedIn" && account.uid === uid;

  // A finger gets no hover to say that Following means Unfollow, so an
  // unfollow happens at once and the way back is offered instead.
  const onFollow = () => {
    const wasFollowing = following.following === true;
    if (following.toggle() === "signIn") {
      setAsking("open");
    } else if (wasFollowing) {
      setNotice({
        text: fill(strings.follow.unfollowed, { name }),
        action: { text: strings.follow.undo, onClick: following.followNow },
      });
    }
  };

  // Follow was the reason for the sign-in, so it is applied right after it:
  // the Firebase user is already the account by then, whatever the page shows.
  const onSignIn = () => {
    setAsking("busy");
    signIn().then((outcome) => {
      setAsking("closed");
      if (outcome.kind === "signedIn") following.followNow();
    });
  };

  const closeAsk = useCallback(() => setAsking("closed"), []);

  const countLine = () => {
    const parts: string[] = [];
    if (following.followers !== null) {
      parts.push(plural(strings.profile.followers, following.followers));
    }
    if (feed.state.status === "ready") {
      parts.push(
        feed.state.next === null
          ? plural(strings.profile.publicLists, lists.length)
          : plural(strings.profile.publicListsMore, lists.length),
      );
    }
    return parts.join(" · ");
  };

  const hiddenAuthor = isAuthorHidden(hidden, uid);

  return (
    <section className="profile">
      <header className="profile__head">
        {photoUrl !== null ? (
          <img className="profile__face" src={photoUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="profile__face profile__face--initial" aria-hidden="true">
            {initialOf(name)}
          </span>
        )}
        <div className="profile__text">
          <h1 className="profile__name">{name}</h1>
          <p className="profile__meta">{countLine()}</p>
          {following.failed && (
            <p className="follow__failed" role="alert">
              <Icon name="cloud_off" />
              {strings.follow.failed}
            </p>
          )}
        </div>
        {own ? (
          <Link className="profile__edit" to="/settings">
            {strings.profile.editInSettings}
          </Link>
        ) : (
          <FollowButton following={following.following} onClick={onFollow} />
        )}
      </header>

      <div className="profile__lists-head">
        <h2 className="profile__lists-title">{strings.profile.lists}</h2>
        <p className="profile__lists-note">{strings.profile.newestFirst}</p>
      </div>

      {hiddenAuthor ? (
        <div className="profile__hidden" role="status">
          <Icon name="visibility_off" />
          <p>{strings.profile.hiddenAuthor}</p>
          <Button variant="tonal" onClick={() => showAuthor(uid)}>
            {strings.list.unhide}
          </Button>
        </div>
      ) : feed.state.status === "ready" && lists.length === 0 ? (
        <p className="profile__none">{strings.profile.noLists}</p>
      ) : (
        <FeedGrid
          state={feed.state}
          label={strings.profile.lists}
          retry={feed.retry}
          more={feed.more}
        />
      )}

      <SignInDialog
        open={asking !== "closed"}
        busy={asking === "busy"}
        title={strings.follow.signInTitle}
        body={strings.follow.signInBody}
        onSignIn={onSignIn}
        onCancel={closeAsk}
      />
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
