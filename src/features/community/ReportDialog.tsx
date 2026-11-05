import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { REPORT_NOTE_MAX, OFFERED_REASONS, type ReportReason } from "../../api/community";
import { REASON_TEXT } from "./reasons";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import "./report.css";

/** No sign-in and no wait: the list is hidden as the report goes, and the receipt comes at once. */
export type ReportState = "closed" | "open" | "sent";

interface ReportDialogProps {
  state: ReportState;
  /** Whose lists the person may hide along with this one; nobody's when the list has no author. */
  authorName: string | null;
  /** Sends the complaint; the caller decides what happens after. */
  send: (reason: ReportReason, note: string | null, hideAuthor: boolean) => void;
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
  initial,
  onClose,
  children,
  onSubmit,
}: {
  labelledBy: string;
  className?: string;
  initial?: string;
  onClose: () => void;
  children: ReactNode;
  /** Given, the box is a form, and Enter in it sends. */
  onSubmit?: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  useModal(box, onClose, initial);
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
    <div className="scrim" onClick={onClose}>
      {onSubmit === undefined ? (
        <div {...dialog}>{children}</div>
      ) : (
        // A form may not be the dialog itself; this one lays out as the box's own children.
        <div {...dialog}>
          <form
            className="dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {children}
          </form>
        </div>
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
export function ReportDialog(props: ReportDialogProps) {
  // Mounted afresh each time it opens, so a cancelled report leaves nothing behind.
  return props.state === "closed" ? null : <OpenReportDialog {...props} />;
}

function OpenReportDialog({ state, authorName, send, onHideAuthor, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [hideAuthor, setHideAuthor] = useState(false);

  if (state === "sent") {
    return (
      <Modal key="sent" labelledBy="report-sent-title" onClose={onClose}>
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
      initial="input[type='radio']"
      onClose={onClose}
      onSubmit={() => {
        if (reason !== null) {
          send(reason, note.trim() || null, hideAuthor && authorName !== null);
        }
      }}
    >
      <h2 id="report-title" className="dialog__title">
        {strings.report.title}
      </h2>
      <p className="dialog__body">{strings.report.body}</p>
      <fieldset className="report__reasons">
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
            onChange={(event) => setHideAuthor(event.target.checked)}
          />
          <span>{fill(strings.report.hideAuthor, { name: authorName })}</span>
        </label>
      )}
      <p className="report__footnote">{strings.report.byHand}</p>
      <div className="dialog__actions">
        <Button onClick={onClose}>{strings.report.cancel}</Button>
        <button type="submit" className="btn dialog__danger" disabled={reason === null}>
          <span>{strings.report.send}</span>
        </button>
      </div>
    </Modal>
  );
}
