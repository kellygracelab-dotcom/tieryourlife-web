import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { REPORT_NOTE_MAX, OFFERED_REASONS, type ReportReason } from "../../api/community";
import { REASON_TEXT } from "./reasons";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { InAppNote } from "../../ui/InAppNote";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import "./report.css";

export type ReportState =
  "closed" | "signIn" | "signingIn" | "open" | "sending" | "failed" | "sent";

interface ReportDialogProps {
  state: ReportState;
  /** Whose lists the person may hide along with this one; nobody's when the list has no author. */
  authorName: string | null;
  /** Sends the complaint; the caller decides what happens after. */
  send: (reason: ReportReason, note: string | null, hideAuthor: boolean) => void;
  /** A guest chose to sign in, or to hide the list instead. */
  onSignIn: () => void;
  onHideInstead: () => void;
  /** The receipt's offer, as in the app's: everything from the author, when the box was left unticked. */
  onHideAuthor?: () => void;
  onClose: () => void;
}

/**
 * The scrim and the box every step of the dialog stands in. Each step is
 * mounted on its own, so the focus goes into each as it comes, and the last
 * one hands it back to whatever opened the first.
 */
function Modal({
  labelledBy,
  className = "dialog",
  busy,
  initial,
  onClose,
  children,
  onSubmit,
}: {
  labelledBy: string;
  className?: string;
  busy: boolean;
  initial?: string;
  onClose: () => void;
  children: ReactNode;
  /** Given, the box is a form, and Enter in it sends. */
  onSubmit?: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  useModal(
    box,
    () => {
      if (!busy) onClose();
    },
    initial,
  );
  const dialog = {
    ref: (node: HTMLElement | null) => {
      box.current = node;
    },
    className,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
    onClick: (event: MouseEvent) => event.stopPropagation(),
  };
  return createPortal(
    <div className="scrim" onClick={busy ? undefined : onClose}>
      {onSubmit === undefined ? (
        <div {...dialog}>{children}</div>
      ) : (
        <form
          {...dialog}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      )}
    </div>,
    document.body,
  );
}

/**
 * The app's report sheet as a dialog: a reason, an optional note, and the
 * choice to hide the author too. The dialog stays and becomes the receipt,
 * because reported means hidden for this person and both are said at once.
 */
export function ReportDialog({
  state,
  authorName,
  send,
  onSignIn,
  onHideInstead,
  onHideAuthor,
  onClose,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [hideAuthor, setHideAuthor] = useState(false);
  const sendButton = useRef<HTMLButtonElement>(null);
  const busy = state === "sending" || state === "signingIn";

  // Sending took the button out of reach; a refused send gives it back.
  useEffect(() => {
    if (state === "failed") sendButton.current?.focus();
  }, [state]);

  if (state === "closed") return null;

  if (state === "signIn" || state === "signingIn") {
    return (
      <Modal
        key="signIn"
        labelledBy="report-signin-title"
        className="dialog dialog--narrow"
        busy={busy}
        initial=".report__google"
        onClose={onClose}
      >
        <h2 id="report-signin-title" className="dialog__title">
          {strings.report.signInTitle}
        </h2>
        <p className="dialog__body">{strings.report.signInBody}</p>
        <InAppNote />
        <div className="dialog__actions">
          <Button onClick={onClose} disabled={busy}>
            {strings.report.cancel}
          </Button>
          <Button onClick={onHideInstead} disabled={busy}>
            {strings.report.hideInstead}
          </Button>
          <Button variant="filled" className="report__google" onClick={onSignIn} disabled={busy}>
            {busy ? strings.keep.busy : strings.keep.google}
          </Button>
        </div>
      </Modal>
    );
  }

  if (state === "sent") {
    return (
      <Modal key="sent" labelledBy="report-sent-title" busy={false} onClose={onClose}>
        <Icon name="check_circle" className="report__sent-icon" />
        <h2 id="report-sent-title" className="dialog__title report__sent-title">
          {strings.report.sentTitle}
        </h2>
        <p className="dialog__body">{strings.report.sentBody}</p>
        <div className="dialog__actions">
          {authorName !== null && !hideAuthor && onHideAuthor !== undefined && (
            <Button onClick={onHideAuthor}>
              {fill(strings.report.hideAuthor, { name: authorName })}
            </Button>
          )}
          <Button variant="filled" onClick={onClose}>
            {strings.report.done}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      key="form"
      labelledBy="report-title"
      className="dialog report"
      busy={busy}
      initial="input[type='radio']"
      onClose={onClose}
      onSubmit={() => {
        if (reason !== null && !busy) {
          send(reason, note.trim() || null, hideAuthor && authorName !== null);
        }
      }}
    >
      <h2 id="report-title" className="dialog__title">
        {strings.report.title}
      </h2>
      <p className="dialog__body">{strings.report.body}</p>
      <fieldset className="report__reasons" disabled={busy}>
        <legend className="report__legend">{strings.report.why}</legend>
        {OFFERED_REASONS.map((option) => (
          <label key={option} className="report__reason">
            <input
              type="radio"
              name="reason"
              value={option}
              checked={reason === option}
              onChange={() => setReason(option)}
            />
            <span>{REASON_TEXT[option]}</span>
          </label>
        ))}
      </fieldset>
      <label className="report__note-label" htmlFor="report-note">
        {strings.report.noteLabel}
      </label>
      <textarea
        id="report-note"
        className="report__note"
        value={note}
        maxLength={REPORT_NOTE_MAX}
        rows={3}
        placeholder={strings.report.notePlaceholder}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
      />
      <p
        className={
          note.length >= REPORT_NOTE_MAX
            ? "report__counter report__counter--full"
            : "report__counter"
        }
        aria-hidden="true"
      >
        {fill(strings.report.noteCounter, { n: note.length, max: REPORT_NOTE_MAX })}
      </p>
      {authorName !== null && (
        <label className="report__hide">
          <input
            type="checkbox"
            checked={hideAuthor}
            disabled={busy}
            onChange={(event) => setHideAuthor(event.target.checked)}
          />
          <span>{fill(strings.report.hideAuthor, { name: authorName })}</span>
        </label>
      )}
      <p className="report__footnote">{strings.report.byHand}</p>
      {state === "failed" && (
        <p className="dialog__bar" role="alert">
          <Icon name="cloud_off" className="dialog__bar-icon" />
          {strings.report.failed}
        </p>
      )}
      <div className="dialog__actions">
        <Button onClick={onClose} disabled={busy}>
          {strings.report.cancel}
        </Button>
        <button
          ref={sendButton}
          type="submit"
          className="btn dialog__danger"
          disabled={reason === null || busy}
        >
          <span>{busy ? strings.report.sending : strings.report.send}</span>
        </button>
      </div>
    </Modal>
  );
}
