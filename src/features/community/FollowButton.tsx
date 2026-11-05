import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import "./follow.css";

interface FollowButtonProps {
  following: boolean | null;
  onClick: () => void;
  /** A card's button is shorter and fills its width; a chip sits in a line of text. */
  size?: "profile" | "card" | "chip";
}

/**
 * Follow in the primary-container colours, or Following with a check that
 * turns into Unfollow under a pointer. Never a spinner: one tap, and the
 * answer is assumed. Until the backend has said, the button keeps its place
 * unseen, as the app draws none: a Follow before then would ask somebody to
 * undo what they never did.
 */
export function FollowButton({ following, onClick, size = "profile" }: FollowButtonProps) {
  const on = following === true;
  const waiting = following === null;
  const classes = [
    "btn",
    "follow",
    on && "follow--on",
    waiting && "follow--waiting",
    size !== "profile" && `follow--${size}`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={on}
      disabled={waiting}
      aria-hidden={waiting || undefined}
      onClick={onClick}
    >
      {on && <Icon name="check" className="btn__icon follow__check" />}
      <span className="follow__label">{on ? strings.follow.following : strings.follow.follow}</span>
      {on && <span className="follow__unfollow">{strings.follow.unfollow}</span>}
    </button>
  );
}
