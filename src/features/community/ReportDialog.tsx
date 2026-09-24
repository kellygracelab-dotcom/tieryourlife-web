import { useEffect, useRef, useState, type ReactNode } from "react";
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from "../../api/community";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { InAppNote } from "../../ui/InAppNote";
import { Icon } from "../../ui/Icon";
import "./report.css";

export type ReportState =
  "closed" | "signIn" | "signingIn" | "open" | "sending" | "failed" | "sent";

interface ReportDialogProps {
  state: ReportState;
  authorName: string;
  /** Sends the complaint; the caller decides what happens after. */
  send: (reason: ReportReason, note: string | null, hideAuthor: boolean) => void;
  /** A guest chose to sign in, or to hide the list instead. */
  onSignIn: () => void;
  onHideInstead: () => void;
  onClose: () => void;
}

const REASON_TEXT: Record<ReportReason, string> = {
  sexual: strings.report.reasonSexual,
  hate: strings.report.reasonHate,
  violence: strings.report.reasonViolence,
  spam: strings.report.reasonSpam,
  other: strings.report.reasonOther,
};

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
  onClose,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [hideAuthor, setHideAuthor] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const open = state !== "closed";
  const busy = state === "sending" || state === "signingIn";

  useEffect(() => {
    if (state === "open") first.current?.focus();
  }, [state]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const scrim = (children: ReactNode, labelledBy: string, className = "dialog") => (
    <div className="scrim" onClick={busy ? undefined : onClose}>
      <div
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  if (state === "signIn" || state === "signingIn") {
    return scrim(
      <>
        <h2 id="report-signin-title" className="dialog__title">
          {strings.report.signInTitle}
        </h2>
        <p className="dialog__body">{strings.report.signInBody}</p>
        <InAppNote />
        <div className="dialog__actions">
          <Button onClick={onHideInstead} disabled={busy}>
            {strings.report.hideInstead}
          </Button>
          <Button variant="filled" onClick={onSignIn} disabled={busy}>
            {busy ? strings.keep.busy : strings.keep.google}
          </Button>
        </div>
      </>,
      "report-signin-title",
      "dialog dialog--narrow",
    );
  }

  if (state === "sent") {
    return scrim(
      <>
        <Icon name="check_circle" className="report__sent-icon" />
        <h2 id="report-sent-title" className="dialog__title report__sent-title">
          {strings.report.sentTitle}
        </h2>
        <p className="dialog__body">{strings.report.sentBody}</p>
        <div className="dialog__actions">
          <Button variant="filled" onClick={onClose}>
            {strings.report.done}
          </Button>
        </div>
      </>,
      "report-sent-title",
    );
  }

  return (
    <div className="scrim" onClick={busy ? undefined : onClose}>
      <form
        className="dialog report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (reason !== null && !busy) send(reason, note.trim() || null, hideAuthor);
        }}
      >
        <h2 id="report-title" className="dialog__title">
          {strings.report.title}
        </h2>
        <p className="dialog__body">{strings.report.body}</p>
        <fieldset className="report__reasons" disabled={busy}>
          <legend className="report__legend">{strings.report.why}</legend>
          {REPORT_REASONS.map((option, index) => (
            <label key={option} className="report__reason">
              <input
                ref={index === 0 ? first : undefined}
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
        <label className="report__hide">
          <input
            type="checkbox"
            checked={hideAuthor}
            disabled={busy}
            onChange={(event) => setHideAuthor(event.target.checked)}
          />
          <span>{fill(strings.report.hideAuthor, { name: authorName })}</span>
        </label>
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
          <button type="submit" className="btn dialog__danger" disabled={reason === null || busy}>
            <span>{busy ? strings.report.sending : strings.report.send}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
