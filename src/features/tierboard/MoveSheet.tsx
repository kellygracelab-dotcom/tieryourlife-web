import { useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PublishedTier } from "../../api/types";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { shownLight } from "../../lib/tierColour";

interface MoveSheetProps {
  /** The card's name, which is the sheet's title. */
  name: string;
  /** About the picture: who made it, its licence, the page it is from. */
  onAbout?: (() => void) | undefined;
  /** The page the picture is from, in a new tab. */
  onOpenPage?: (() => void) | undefined;
  /** Adjust picture: which part of it the tile shows. */
  onAdjust?: (() => void) | undefined;
  tiers: readonly PublishedTier[];
  /** Where the card is now, or null in the pool. */
  current: number | null;
  onPlace: (tier: number) => void;
  onUnplace: () => void;
  /** Rename: the owner's, on any card of their own list (night pass W22). */
  onRename?: (() => void) | undefined;
  onRemove?: () => void;
  onClose: () => void;
}

/**
 * A card's sheet (artboard 37, as the app's 11): its name with a cross, the
 * picture's links, MOVE TO A TIER with every tier a row (the current one lit,
 * "Currently here"), then Back to the deck, Rename on one's own list and,
 * last and red, Remove from list, each under a line. It lies on the body, not in the tile, so a pool
 * that scrolls cannot clip it; the cross, a press outside and Escape close
 * it, and the keyboard gets what `useModal` gives every dialog.
 */
export function MoveSheet({
  name,
  onAbout,
  onOpenPage,
  onAdjust,
  tiers,
  current,
  onPlace,
  onUnplace,
  onRename,
  onRemove,
  onClose,
}: MoveSheetProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useModal(box, onClose, ".move-sheet__tier:not([disabled]), button:not([disabled])");

  return createPortal(
    <div
      className="scrim"
      onClick={onClose}
      // A double click opens the sheet with its first click; its second lands
      // here and must neither close the sheet nor press the row under it.
      onClickCapture={(event) => {
        if (event.detail > 1) event.stopPropagation();
      }}
    >
      <div
        ref={box}
        className="dialog dialog--narrow move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet__head">
          <h2 id={`${id}-title`} className="dialog__title move-sheet__title">
            {name}
          </h2>
          <button
            type="button"
            className="move-sheet__close"
            aria-label={strings.rankings.close}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {(onAbout !== undefined || onOpenPage !== undefined || onAdjust !== undefined) && (
          <div className="move-sheet__picture">
            {onAbout && (
              <button type="button" className="move-sheet__link" onClick={onAbout}>
                {strings.link.about}
              </button>
            )}
            {onOpenPage && (
              <button type="button" className="move-sheet__link" onClick={onOpenPage}>
                {strings.link.openPage}
              </button>
            )}
            {onAdjust && (
              <button type="button" className="move-sheet__link" onClick={onAdjust}>
                {strings.cover.adjustPicture}
              </button>
            )}
          </div>
        )}
        <p className="move-sheet__who">{strings.boards.moveTo}</p>
        <ul className="move-sheet__tiers">
          {tiers.map((tier, index) => (
            <li key={`${index}-${tier.label}`}>
              <button
                type="button"
                className={
                  index === current ? "move-sheet__tier move-sheet__tier--here" : "move-sheet__tier"
                }
                disabled={index === current}
                onClick={() => onPlace(index)}
              >
                <span
                  className="move-sheet__swatch band"
                  style={
                    {
                      "--band-light": shownLight(tier.colorLight),
                      "--band-dark": tier.colorDark,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
                <span className="move-sheet__label">{tier.label}</span>
                {tier.caption !== null && tier.caption !== "" && (
                  <span className="move-sheet__caption">{tier.caption}</span>
                )}
                {index === current && (
                  <span className="move-sheet__note">{strings.boards.currentTier}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {current !== null && (
          <>
            <hr className="move-sheet__line" />
            <button type="button" className="move-sheet__row" onClick={onUnplace}>
              <Icon name="undo" className="move-sheet__row-icon" />
              {strings.boards.backToPool}
            </button>
          </>
        )}
        {onRename !== undefined && (
          <>
            <hr className="move-sheet__line" />
            <button type="button" className="move-sheet__row" onClick={onRename}>
              <Icon name="edit" className="move-sheet__row-icon" />
              {strings.card.rename}
            </button>
          </>
        )}
        {onRemove !== undefined && (
          <>
            <hr className="move-sheet__line" />
            <button
              type="button"
              className="move-sheet__row move-sheet__row--danger"
              onClick={onRemove}
            >
              <Icon name="delete" className="move-sheet__row-icon" />
              {strings.boards.removeFromList}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
