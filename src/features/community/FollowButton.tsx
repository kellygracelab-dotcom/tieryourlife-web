import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import "./follow.css";

interface FollowButtonProps {
  following: boolean | null;
  onClick: () => void;
  /** A card's button is shorter and fills its width. */
  size?: "profile" | "card";
}

/**
 * Follow, or Following with a check that turns into Unfollow under the
 * pointer. Never a spinner: one tap, and the answer is assumed.
 */
export function FollowButton({ following, onClick, size = "profile" }: FollowButtonProps) {
  const on = following === true;
  const classes = [
    "btn",
    on ? "btn--tonal follow follow--on" : "btn--filled follow",
    size === "card" ? "follow--card" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={on}
      disabled={following === null}
      onClick={onClick}
    >
      {on && <Icon name="check" className="btn__icon follow__check" />}
      <span className="follow__label">{on ? strings.follow.following : strings.follow.follow}</span>
      {on && <span className="follow__unfollow">{strings.follow.unfollow}</span>}
    </button>
  );
}
