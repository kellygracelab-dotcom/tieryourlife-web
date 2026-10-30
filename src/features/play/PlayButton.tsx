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
}

/**
 * Play on the board's bar: from 840 an outlined button, play_arrow before the
 * word; narrower, the icon alone, 40 round, in the primary colour, with the
 * word as its tooltip. One button whose word CSS hides, so the name it is
 * read by never changes with the window. Disabled it stays focusable
 * (aria-disabled), so the reason reaches a tooltip and a screen reader alike;
 * the dot is said in words as well.
 */
export function PlayButton({ onClick, disabled, saved }: PlayButtonProps) {
  const id = useId();
  const description = [disabled && strings.play.needsCards, saved && strings.play.savedGame]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <button
        type="button"
        className="btn play-button"
        aria-disabled={disabled || undefined}
        // Enabled, the tooltip names it; a label as well would read "Play" twice, once
        // as the name and once as the description. Disabled, the tooltip is the reason.
        aria-label={disabled ? strings.play.play : undefined}
        aria-describedby={description === "" ? undefined : `${id}-why`}
        title={disabled ? strings.play.needsCards : strings.play.play}
        onClick={disabled ? undefined : onClick}
      >
        <Icon name="play_arrow" className="btn__icon play-button__icon" />
        <span className="play-button__word" aria-hidden="true">
          {strings.play.play}
        </span>
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
