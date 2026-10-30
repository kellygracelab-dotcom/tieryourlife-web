import { useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { lessMotion } from "./media";
import { LEAVE_MS, LEAVE_REDUCED_MS, SheetArrival, SheetLeave } from "./sheet";
import "./play.css";

interface PlaySheetProps {
  title: string;
  /** A page reached from another: an arrow back at the start of the title row. */
  onBack?: () => void;
  /** Under the title: what the game is over. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Pinned to the sheet's foot, under whatever scrolls. */
  footer?: ReactNode;
  /** The buttons; a SheetCancel among them closes the sheet as the scrim and Escape do. */
  actions: ReactNode;
  /** Called once the sheet has gone. */
  onClose: () => void;
}

/**
 * The one container the picker and the choice of cards share: a dialog 520
 * wide on a scrim, a sheet from the bottom with a handle below 600, as the
 * app's. It comes in and goes out with the design's motion. The focus moves
 * in, stays in, and goes back to the Play button when it closes; Escape and
 * the scrim close it.
 */
export function PlaySheet({
  title,
  onBack,
  subtitle,
  children,
  footer,
  actions,
  onClose,
}: PlaySheetProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const arriving = useContext(SheetArrival);
  const [leaving, setLeaving] = useState(false);
  const leave = () => setLeaving(true);
  useModal(box, leave);

  // Gone once the exit has played; the latest onClose is the one called.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => close.current(), lessMotion() ? LEAVE_REDUCED_MS : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const motion = leaving ? " play-scrim--leaving" : arriving ? " play-scrim--arriving" : "";
  return createPortal(
    <div className={`scrim play-scrim${motion}`} onClick={leave}>
      <div
        ref={box}
        className="dialog play-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="play-sheet__handle" aria-hidden="true" />
        <div className="play-sheet__scroll">
          <div
            className={
              onBack === undefined ? "play-sheet__head" : "play-sheet__head play-sheet__head--back"
            }
          >
            {onBack !== undefined && (
              <button
                type="button"
                className="play-sheet__back"
                aria-label={strings.play.back}
                onClick={onBack}
              >
                <Icon name="arrow_back" className="ms--mirrored" />
              </button>
            )}
            <h2 id={`${id}-title`} className="dialog__title">
              {title}
            </h2>
          </div>
          {subtitle !== undefined && <p className="play-sheet__subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer}
        <div className="dialog__actions play-sheet__actions">
          <SheetLeave.Provider value={leave}>{actions}</SheetLeave.Provider>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "Cancel" in a sheet's buttons: the sheet goes, exit and all. */
export function SheetCancel() {
  const leave = useContext(SheetLeave);
  return <Button onClick={leave}>{strings.play.cancel}</Button>;
}
