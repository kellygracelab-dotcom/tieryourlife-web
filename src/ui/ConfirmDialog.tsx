import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

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
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (busy) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const keepTabInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || box.current === null) return;
    const inside = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="scrim" onClick={busy ? undefined : onCancel}>
      <div
        ref={box}
        className={narrow ? "dialog dialog--narrow" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepTabInside}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{body}</div>
        {trouble}
        <div className="dialog__actions">
          <button
            ref={cancel}
            type="button"
            className="btn btn--text"
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
