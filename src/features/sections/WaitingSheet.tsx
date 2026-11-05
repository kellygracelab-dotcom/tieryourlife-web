import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorOf } from "../../api/errors";
import { withdrawSectionProposal } from "../../lib/api";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import type { Section } from "./model";
import "./proposal.css";

/**
 * A waiting section as its proposer opens it (docs/design-spec-parity.md,
 * "Waiting section"): what happens next, where the lists are meanwhile, and
 * the way to take it back, asked once more in place since it cannot be undone.
 * A waiting topic opens the same sheet without that way: its proposer has
 * none yet, in the app or on the backend.
 */
export function WaitingSheet({
  section,
  filedIn,
  topic = false,
  note,
  withdraw = withdrawSectionProposal,
  onWithdrawn,
  onSettled,
  onClose,
}: {
  section: Pick<Section, "id" | "name">;
  /** The name of the section its lists wait in. */
  filedIn: string;
  /** A waiting topic: its lists are in its section already, under its label. */
  topic?: boolean;
  /** A line under the rest, quieter. */
  note?: string;
  withdraw?: (id: string) => Promise<void>;
  /** Without it the sheet offers no way to take the proposal back. */
  onWithdrawn?: () => void;
  /** A moderator decided it while it was open: 409 SETTLED. */
  onSettled?: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  useModal(box, () => {
    if (!busy) onClose();
  });

  // The question takes the place of the button that asked it, and the focus
  // with it; a refused withdrawal leaves it on the way to try again. The
  // focus never falls to the page behind.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (wasAsking.current) {
      box.current?.querySelector<HTMLElement>(".waiting-sheet__withdraw")?.focus();
    }
    wasAsking.current = asking;
  }, [asking]);
  useEffect(() => {
    if (failed) again.current?.focus();
  }, [failed]);

  const confirm = () => {
    setBusy(true);
    setFailed(false);
    // The pressed button is disabled while it goes: the dialog holds the focus meanwhile.
    box.current?.focus();
    withdraw(section.id).then(onWithdrawn, (reason: unknown) => {
      setBusy(false);
      if (errorOf(reason).kind === "conflict") onSettled?.();
      else setFailed(true);
    });
  };

  return createPortal(
    <div className="scrim waiting-sheet__scrim" onClick={busy ? undefined : onClose}>
      <div
        ref={box}
        className="dialog waiting-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="waiting-sheet__pill">
          <Icon name="schedule" />
          {strings.sections.waiting}
        </span>
        <h2 id={`${id}-title`} className="dialog__title">
          {section.name}
        </h2>
        <p className="dialog__body">
          {fill(topic ? strings.sections.topicWaitingBody : strings.sections.waitingBody, {
            section: filedIn,
          })}
        </p>
        {note !== undefined && <p className="waiting-sheet__note">{note}</p>}
        {failed && (
          <p className="dialog__bar" role="alert">
            {strings.propose.withdrawFailed}
          </p>
        )}
        {asking ? (
          <div
            className="dialog__actions waiting-sheet__ask"
            role="group"
            aria-labelledby={`${id}-ask`}
          >
            <p id={`${id}-ask`} className="waiting-sheet__ask-text">
              {fill(strings.propose.withdrawAsk, { name: section.name, section: filedIn })}
            </p>
            <button
              ref={cancel}
              type="button"
              className="btn btn--text"
              onClick={() => setAsking(false)}
              disabled={busy}
            >
              <span>{strings.admin.cancel}</span>
            </button>
            <button
              ref={again}
              type="button"
              className="btn btn--danger"
              onClick={confirm}
              disabled={busy}
            >
              <span>{strings.propose.withdraw}</span>
            </button>
          </div>
        ) : (
          <div className="dialog__actions">
            {onWithdrawn !== undefined && (
              <Button className="waiting-sheet__withdraw" onClick={() => setAsking(true)}>
                {strings.propose.withdraw}
              </Button>
            )}
            <Button variant="filled" onClick={onClose}>
              {strings.propose.ok}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
