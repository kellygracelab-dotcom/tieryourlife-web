import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "./useModal";

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  /** The destructive action's words; `busyLabel` while it is under way. */
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel: string;
  /** While the action is under way nothing dismisses the dialog. */
  busy?: boolean;
  narrow?: boolean;
  /** What went wrong the last time, shown above the buttons. */
  trouble?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "Are you sure?" before something that cannot be undone. Cancel takes the
 * focus, not the destructive button, for anybody who pressed Enter before
 * reading; Tab stays inside; closing hands the focus back to whatever opened it.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel,
  busy = false,
  narrow = false,
  trouble,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(
    box,
    () => {
      if (!busy) onCancel();
    },
    ".confirm__cancel",
  );

  return createPortal(
    <div className="scrim" onClick={busy ? undefined : onCancel}>
      <div
        ref={box}
        className={narrow ? "dialog dialog--narrow" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{body}</div>
        {trouble}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--text confirm__cancel"
            onClick={onCancel}
            disabled={busy}
          >
            <span>{cancelLabel}</span>
          </button>
          <button type="button" className="btn dialog__danger" onClick={onConfirm} disabled={busy}>
            <span>{busy && busyLabel !== undefined ? busyLabel : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
