import { useCallback, useEffect, useRef, useState } from "react";
import { usePageTitle } from "../app/pageTitle";
import { Link, useLocation, useParams } from "react-router";
import type { ListSummary } from "../api/types";
import { useSession } from "../app/session";
import { keepIntent, takeIntent } from "../features/community/afterSignIn";
import { FollowButton } from "../features/community/FollowButton";
import { isAuthorHidden } from "../features/community/hidden";
import { SignInDialog } from "../features/community/SignInDialog";
import { followFailureText, useFollow, type FollowDeps } from "../features/community/useFollow";
import { useHidden } from "../features/community/useHidden";
import { useReporting, type Report } from "../features/community/useReporting";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed, type LoadFeed } from "../features/feed/useFeed";
import { report as sendReport } from "../lib/api";
import { isEditorialAuthor } from "../lib/editorial";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import { NotFoundPage } from "./NotFoundPage";
import { initialOf } from "../lib/initial";
import "./ProfilePage.css";

/** What a link to a profile may carry along, so the head is drawn before any answer. */
export interface AuthorHint {
  name: string;
  photoUrl: string | null;
}

interface ProfilePageProps {
  load?: LoadFeed;
  follow?: FollowDeps;
  report?: Report;
}

type Asking = "closed" | "open" | "busy";

const NO_LISTS: readonly ListSummary[] = [];

/** An editorial account has no page of its own: its lists stand without an author. */
export function ProfilePage(props: ProfilePageProps) {
  const { uid = "" } = useParams();
  return isEditorialAuthor(uid) ? <NotFoundPage /> : <AuthorProfile {...props} />;
}

function AuthorProfile({ load, follow, report = sendReport }: ProfilePageProps) {
  const { uid = "" } = useParams();
  const location = useLocation();
  const hint = (location.state as { author?: AuthorHint } | null)?.author ?? null;
  const { account, signIn } = useSession();
  const feed = useFeed({ author: uid, sort: "recent" }, load);
  const following = useFollow(uid, follow);
  const { hidden, hideAuthor, showAuthor } = useHidden();
  const [signingIn, setSigningIn] = useState<Asking>("closed");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const lists = feed.state.status === "ready" ? feed.state.lists : NO_LISTS;
  const first = lists[0];
  const own = account?.kind === "signedIn" && account.uid === uid;
  // One's own page wears one's own name. Anybody else's own lists carry a
  // fresher name and face than the link that led here, as the app prefers
  // them; somebody known only by anonymous lists has no name at all.
  const known =
    (own ? account.displayName?.trim() : undefined) ||
    first?.authorName.trim() ||
    hint?.name.trim() ||
    null;
  const photoUrl = own
    ? account.photoUrl
    : first !== undefined
      ? first.authorPhotoUrl
      : (hint?.photoUrl ?? null);
  // Nobody is called Someone while their lists may yet say who they are.
  const naming = known === null && feed.state.status === "loading";
  const name = known ?? strings.profile.someone;
  usePageTitle(naming ? null : name, { inBar: false });
  const [brokenFace, setBrokenFace] = useState<string | null>(null);

  // A finger gets no hover to say that Following means Unfollow, so an
  // unfollow happens at once and the way back is offered instead.
  const unfollowed = useRef<SnackbarNotice | null>(null);
  const onFollow = () => {
    const wasFollowing = following.following === true;
    if (following.toggle() === "signIn") {
      setSigningIn("open");
    } else if (wasFollowing) {
      unfollowed.current = {
        text: fill(strings.follow.unfollowed, { name }),
        action: { text: strings.follow.undo, onClick: following.followNow },
      };
      setNotice(unfollowed.current);
    }
  };

  // A refused unfollow did not happen: its snackbar goes, and the line says so.
  useEffect(() => {
    if (following.failed !== null) setNotice((now) => (now === unfollowed.current ? null : now));
  }, [following.failed]);

  // A follow asked for before a sign-in that went through a redirect.
  const { followNow } = following;
  useEffect(() => {
    if (account?.kind === "signedIn" && !own && takeIntent({ kind: "follow", uid })) followNow();
  }, [account, own, uid, followNow]);

  // Follow was the reason for the sign-in, so it is applied right after it:
  // the Firebase user is already the account by then, whatever the page shows.
  const onSignIn = () => {
    setSigningIn("busy");
    signIn().then((outcome) => {
      setSigningIn("closed");
      if (outcome.kind === "signedIn") following.followNow();
      else if (outcome.kind === "redirecting") keepIntent({ kind: "follow", uid });
    });
  };

  const closeAsk = useCallback(() => setSigningIn("closed"), []);

  const hideAuthorNow = () => {
    // Kept without a name rather than with the placeholder, which Settings says in its own words.
    hideAuthor({ uid, name: known ?? "" });
    setNotice({
      text: fill(strings.profile.hiddenAuthorNotice, { name }),
      action: { text: strings.list.undo, onClick: () => showAuthor(uid) },
    });
  };

  const hiddenAuthor = isAuthorHidden(hidden, uid);

  // Each card's Report, as the app's long press offers it: one dialog for the
  // page, so it outlives the card it hides and the author hidden with it.
  const reporting = useReporting({ report, notify: setNotice });

  // Unhide goes as it is pressed; the menu it stands in for comes back and takes the focus.
  const head = useRef<HTMLElement>(null);
  const toMenu = useRef(false);
  useEffect(() => {
    if (hiddenAuthor || !toMenu.current) return;
    toMenu.current = false;
    head.current?.querySelector<HTMLElement>("summary")?.focus();
  }, [hiddenAuthor]);
  const unhide = () => {
    toMenu.current = true;
    showAuthor(uid);
  };

  return (
    <section className="profile">
      <header className="profile__head" ref={head}>
        {photoUrl !== null && photoUrl !== brokenFace ? (
          <img
            className="profile__face"
            src={photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBrokenFace(photoUrl)}
          />
        ) : (
          <span className="profile__face profile__face--initial" aria-hidden="true">
            {known === null ? <Icon name="person" /> : initialOf(known)}
          </span>
        )}
        <div className="profile__text">
          <h1 className="profile__name" aria-busy={naming || undefined}>
            {naming ? <Skeleton width="160px" height="24px" /> : <bdi>{name}</bdi>}
          </h1>
          {following.failed !== null && (
            <p className="follow__failed" role="alert">
              <Icon name="cloud_off" />
              {followFailureText(following.failed)}
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
        {/* What a reader can do about a person rather than a list, as on the app's author page. */}
        {!own && !hiddenAuthor && !naming && (
          <Menu label={strings.profile.more} button={<Icon name="more_vert" />}>
            <li>
              <button type="button" className="menu__action" onClick={hideAuthorNow}>
                {fill(strings.profile.hideAuthor, { name })}
              </button>
            </li>
          </Menu>
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
          <Button variant="tonal" onClick={unhide}>
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
          showAuthor={false}
          onReport={own ? undefined : reporting.start}
        />
      )}

      <SignInDialog
        open={signingIn !== "closed"}
        busy={signingIn === "busy"}
        title={strings.follow.signInTitle}
        body={strings.follow.signInBody}
        onSignIn={onSignIn}
        onCancel={closeAsk}
      />
      {reporting.dialog}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
