import { useId, useRef, useState } from "react";
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
 */
export function WaitingSheet({
  section,
  filedIn,
  withdraw = withdrawSectionProposal,
  onWithdrawn,
  onSettled,
  onClose,
}: {
  section: Section;
  /** The name of the section its lists wait in. */
  filedIn: string;
  withdraw?: (id: string) => Promise<void>;
  onWithdrawn: () => void;
  /** A moderator decided it while it was open: 409 SETTLED. */
  onSettled: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useModal(box, () => {
    if (!busy) onClose();
  });

  const confirm = () => {
    setBusy(true);
    setFailed(false);
    withdraw(section.id).then(onWithdrawn, (reason: unknown) => {
      setBusy(false);
      if (errorOf(reason).kind === "conflict") onSettled();
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
        onClick={(event) => event.stopPropagation()}
      >
        <span className="waiting-sheet__pill">
          <Icon name="schedule" />
          {strings.sections.waiting}
        </span>
        <h2 id={`${id}-title`} className="dialog__title">
          {section.name}
        </h2>
        <p className="dialog__body">{fill(strings.sections.waitingBody, { section: filedIn })}</p>
        {failed && (
          <p className="dialog__bar" role="alert">
            {strings.propose.withdrawFailed}
          </p>
        )}
        {asking ? (
          <div className="dialog__actions waiting-sheet__ask">
            <p className="waiting-sheet__ask-text">
              {fill(strings.propose.withdrawAsk, { name: section.name, section: filedIn })}
            </p>
            <Button onClick={() => setAsking(false)} disabled={busy}>
              {strings.admin.cancel}
            </Button>
            <Button variant="danger" onClick={confirm} disabled={busy}>
              {strings.propose.withdraw}
            </Button>
          </div>
        ) : (
          <div className="dialog__actions">
            <Button className="waiting-sheet__withdraw" onClick={() => setAsking(true)}>
              {strings.propose.withdraw}
            </Button>
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
