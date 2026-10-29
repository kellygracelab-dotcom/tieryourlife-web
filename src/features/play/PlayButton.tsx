import { useId } from "react";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import "./play.css";

export interface PlayButtonProps {
  onClick: () => void;
  /** Fewer than 3 cards: the button stays, says why, and does nothing. */
  disabled: boolean;
  /** A game is saved for this board: a dot on the button's corner. */
  saved: boolean;
  /** The icon alone, 40 round, for the narrow sticky bar. */
  iconOnly?: boolean;
}

/**
 * Play on the board's bar: outlined, 40 high, play_arrow before the word.
 * Disabled it stays focusable (aria-disabled), so the reason reaches a
 * tooltip and a screen reader alike; the dot is said in words as well.
 */
export function PlayButton({ onClick, disabled, saved, iconOnly = false }: PlayButtonProps) {
  const id = useId();
  const description = [disabled && strings.play.needsCards, saved && strings.play.savedGame]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <button
        type="button"
        className={iconOnly ? "btn play-button play-button--icon" : "btn play-button"}
        aria-disabled={disabled || undefined}
        aria-label={iconOnly ? strings.play.play : undefined}
        aria-describedby={description === "" ? undefined : `${id}-why`}
        title={disabled ? strings.play.needsCards : undefined}
        onClick={disabled ? undefined : onClick}
      >
        <Icon name="play_arrow" className="btn__icon" />
        {!iconOnly && <span>{strings.play.play}</span>}
        {saved && <span className="play-button__dot" />}
      </button>
      {/* Beside the button, not in it: inside, it would join the button's name. */}
      {description !== "" && (
        <span id={`${id}-why`} className="play-hidden">
          {description}
        </span>
      )}
    </>
  );
}
