import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../../ui/useModal";
import "./play.css";

interface PlaySheetProps {
  title: string;
  /** Under the title: what the game is over. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Pinned to the sheet's foot, under whatever scrolls. */
  footer?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}

/**
 * The one container the picker and the choice of cards share: a dialog 520
 * wide on a scrim, the whole screen below 600. The focus moves in, stays in,
 * and goes back to the Play button when it closes; Escape and the scrim close
 * it.
 */
export function PlaySheet({ title, subtitle, children, footer, actions, onClose }: PlaySheetProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);

  return createPortal(
    <div className="scrim play-scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog play-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="play-sheet__scroll">
          <h2 id={`${id}-title`} className="dialog__title">
            {title}
          </h2>
          {subtitle !== undefined && <p className="play-sheet__subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer}
        <div className="dialog__actions play-sheet__actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
