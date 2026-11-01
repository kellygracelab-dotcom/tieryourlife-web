import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { fill, strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { FollowButton } from "./FollowButton";
import { SignInDialog } from "./SignInDialog";
import { useFollow, type FollowDeps } from "./useFollow";
import "./follow.css";

type Notify = (notice: SnackbarNotice) => void;

interface AuthorLineProps {
  /** Empty on a snapshot without it: then there is no page to lead to and nobody to follow. */
  uid: string;
  name: string;
  photoUrl: string | null;
  /** One's own list names its author and offers no Follow. */
  own: boolean;
  notify: Notify;
  follow?: FollowDeps;
}

/**
 * The second place following lives, as in the app: under the list's title,
 * the moment somebody most wants to follow and least wants to leave the page.
 */
export function AuthorLine({ uid, name, photoUrl, own, notify, follow }: AuthorLineProps) {
  const byline = fill(strings.list.by, { name });
  return (
    <div className="byline">
      {uid === "" ? (
        <span className="byline__name">{byline}</span>
      ) : (
        <Link
          className="byline__name"
          to={`/u/${encodeURIComponent(uid)}`}
          state={{ author: { name, photoUrl } }}
        >
          {byline}
        </Link>
      )}
      {!own && uid !== "" && <FollowChip uid={uid} name={name} notify={notify} deps={follow} />}
    </div>
  );
}

type Asking = "closed" | "open" | "busy";

function FollowChip({
  uid,
  name,
  notify,
  deps,
}: {
  uid: string;
  name: string;
  notify: Notify;
  deps?: FollowDeps;
}) {
  const { signIn } = useSession();
  // No count on this page, so a guest is not signed in only to be told they follow nobody.
  const following = useFollow(uid, deps, { counted: false });
  const [asking, setAsking] = useState<Asking>("closed");
  const closeAsk = useCallback(() => setAsking("closed"), []);

  useEffect(() => {
    if (following.failed) notify({ text: strings.follow.failed });
  }, [following.failed, notify]);

  // The profile's ways: an unfollow at once with the way back offered, a guest asked to sign in first.
  const onFollow = () => {
    const wasFollowing = following.following === true;
    if (following.toggle() === "signIn") {
      setAsking("open");
    } else if (wasFollowing) {
      notify({
        text: fill(strings.follow.unfollowed, { name }),
        action: { text: strings.follow.undo, onClick: following.followNow },
      });
    }
  };

  const onSignIn = () => {
    setAsking("busy");
    signIn().then((outcome) => {
      setAsking("closed");
      if (outcome.kind === "signedIn") following.followNow();
    });
  };

  // Nothing to press until the backend has said: a chip before then would
  // offer to undo what nobody did. Its place is kept, unseen, or the line
  // grew under the title when it came.
  if (following.following === null) {
    return (
      <span className="byline__waiting" aria-hidden="true">
        <FollowButton following={false} onClick={() => undefined} size="chip" />
      </span>
    );
  }
  return (
    <>
      <FollowButton following={following.following} onClick={onFollow} size="chip" />
      <SignInDialog
        open={asking !== "closed"}
        busy={asking === "busy"}
        title={strings.follow.signInTitle}
        body={strings.follow.signInBody}
        onSignIn={onSignIn}
        onCancel={closeAsk}
      />
    </>
  );
}
