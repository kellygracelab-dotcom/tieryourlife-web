import { useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PublishedTier } from "../../api/types";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";

interface MoveSheetProps {
  /** The card's name, which is the sheet's title. */
  name: string;
  tiers: readonly PublishedTier[];
  /** Where the card is now, or null in the pool. */
  current: number | null;
  onPlace: (tier: number) => void;
  onUnplace: () => void;
  onRemove?: () => void;
  onClose: () => void;
}

/**
 * The phone's move sheet: every tier by a press, back to the pool, off the
 * list. It lies on the body, not in the tile, so a pool that scrolls cannot
 * clip it; a press outside closes it, and the keyboard gets what `useModal`
 * gives every dialog.
 */
export function MoveSheet({
  name,
  tiers,
  current,
  onPlace,
  onUnplace,
  onRemove,
  onClose,
}: MoveSheetProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useModal(box, onClose, "button:not([disabled])");

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {name}
        </h2>
        <p className="move-sheet__who">{strings.boards.moveTo}</p>
        <ul className="move-sheet__tiers">
          {tiers.map((tier, index) => (
            <li key={`${index}-${tier.label}`}>
              <button
                type="button"
                className="move-sheet__tier"
                disabled={index === current}
                onClick={() => onPlace(index)}
              >
                <span
                  className="move-sheet__swatch band"
                  style={
                    {
                      "--band-light": tier.colorLight,
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
        <div className="dialog__actions move-sheet__actions">
          {current !== null && (
            <Button variant="tonal" onClick={onUnplace}>
              {strings.boards.backToPool}
            </Button>
          )}
          {onRemove !== undefined && (
            <Button className="move-sheet__danger" onClick={onRemove}>
              {strings.boards.removeFromList}
            </Button>
          )}
          <Button onClick={onClose}>{strings.rank.cancel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
