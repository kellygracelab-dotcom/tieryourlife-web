import type { CSSProperties, MouseEvent } from "react";
import type { PublishedItem, PublishedTier } from "../../api/types";
import { sizedFor } from "../../lib/pictureSize";
import { fill, strings } from "../../strings";
import "../../ui/Button.css";
import { FocusedPicture } from "../../ui/FocusedPicture";
import { Icon } from "../../ui/Icon";
import { useBrokenPicture } from "../../ui/useBrokenPicture";
import { CardName } from "./CardName";
import type { BoardSize } from "./nameFit";

/** Where the device keeps whether the pool shows one card at a time; it is not synced. */
export const ONE_BY_ONE_KEY = "tyl.board.oneByOne";

/** The big card is asked for at this width: twice its widest drawing, for a sharp picture. */
const CARD_WIDTH = 320;

interface OneByOneProps {
  card: PublishedItem;
  item: number;
  tiers: PublishedTier[];
  /** The tier the card is in, or null while it waits in the pool. */
  placedIn: number | null;
  board: BoardSize;
  locked: boolean;
  /** Another card waits in the pool, so a skip has somewhere to go. */
  canSkip: boolean;
  /** The keyboard has number keys for the tiers: the hint names them. */
  keys: number;
  onPlace: (tier: number) => void;
  onSkip: () => void;
  onUnplace: () => void;
}

/**
 * A pointer's press leaves no focus on the panel's buttons: Space would press
 * the same tier again, where the board takes it for a skip.
 */
const pressed = (then: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  if (event.detail > 0) event.currentTarget.blur();
  then();
};

/**
 * The pool one card at a time, as the phone app has it: the card large, a
 * button for every tier, and Skip. A tier puts the card last in it and the
 * pool's next card comes up; Skip leaves the pool's order alone and comes
 * back round to the skipped cards. A card tapped on the board comes up here
 * too: a tier moves it, and To the pool puts it at the pool's end.
 */
export function OneByOne({
  card,
  item,
  tiers,
  placedIn,
  board,
  locked,
  canSkip,
  keys,
  onPlace,
  onSkip,
  onUnplace,
}: OneByOneProps) {
  const [broken, onBroken] = useBrokenPicture(card.imageUrl);
  const pictured = card.imageUrl !== null && !broken;
  const range = keys > 1 ? `1–${keys}` : "1";
  return (
    <div className="one">
      <div
        className={pictured ? "one__card" : "one__card one__card--name"}
        data-item={item}
        aria-hidden="true"
      >
        {pictured && card.imageUrl !== null ? (
          <FocusedPicture
            {...sizedFor(card.imageUrl, CARD_WIDTH)}
            focus={card.pictureFocus}
            draggable={false}
            onError={onBroken}
          />
        ) : (
          <CardName title={card.title} board={board} />
        )}
      </div>
      <div className="one__side">
        <p className="one__name" aria-live="polite">
          <bdi>{card.title}</bdi>
        </p>
        <div className="one__tiers">
          {tiers.map((tier, index) => {
            const where =
              tier.caption === null || tier.caption === ""
                ? tier.label
                : `${tier.label} · ${tier.caption}`;
            return (
              <button
                key={`${index}-${tier.label}`}
                type="button"
                className="one__tier band"
                style={
                  {
                    "--band-light": tier.colorLight,
                    "--band-dark": tier.colorDark,
                  } as CSSProperties
                }
                aria-label={fill(strings.rank.placeIn, { name: card.title, tier: where })}
                aria-current={placedIn === index ? "true" : undefined}
                aria-keyshortcuts={index < keys ? String(index + 1) : undefined}
                title={where}
                disabled={locked}
                onClick={pressed(() => onPlace(index))}
              >
                <bdi className="one__tier-label">{tier.label}</bdi>
              </button>
            );
          })}
        </div>
        <div className="one__foot">
          <button
            type="button"
            className="btn btn--tonal one__skip"
            aria-keyshortcuts={placedIn === null ? "Space" : "Backspace"}
            disabled={locked || (placedIn === null && !canSkip)}
            onClick={pressed(placedIn === null ? onSkip : onUnplace)}
          >
            <Icon name={placedIn === null ? "skip_next" : "undo"} className="btn__icon" />
            <span>
              {placedIn === null ? strings.rank.oneByOneSkip : strings.rank.oneByOneToPool}
            </span>
          </button>
          <p className="one__keys">
            {fill(placedIn === null ? strings.rank.oneByOneKeys : strings.rank.oneByOneKeysPlaced, {
              keys: range,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

interface OneByOneToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

/** The pool's switch between every card at once and one card at a time. */
export function OneByOneToggle({ on, onChange }: OneByOneToggleProps) {
  return (
    <button
      type="button"
      className={on ? "one-toggle one-toggle--on" : "one-toggle"}
      aria-pressed={on}
      onClick={pressed(() => onChange(!on))}
    >
      <Icon name={on ? "check" : "view_agenda"} />
      <span>{strings.rank.oneByOne}</span>
    </button>
  );
}
