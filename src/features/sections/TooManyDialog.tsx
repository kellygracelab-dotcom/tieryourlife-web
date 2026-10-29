import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import { waitingPath, type Section } from "./model";
import { PENDING_MAX } from "./proposal";
import "./proposal.css";

/**
 * In place of the form when three proposals already wait (docs/design-spec-
 * admin.md, 2.5): why there is no fourth yet, and the three, each a way to
 * its waiting tile.
 */
export function TooManyDialog({
  waiting,
  onClose,
}: {
  waiting: readonly Section[];
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow too-many"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {plural(strings.propose.tooManyTitle, Math.max(PENDING_MAX, waiting.length))}
        </h2>
        <p id={`${id}-body`} className="dialog__body">
          {strings.propose.tooManyBody}
        </p>
        <div className="dialog__actions">
          <Button variant="filled" onClick={onClose}>
            {strings.propose.ok}
          </Button>
        </div>
        {waiting.length > 0 && (
          <ul className="too-many__list" aria-label={strings.propose.yours}>
            {waiting.map((one) => (
              <li key={one.id}>
                <Link to={waitingPath(one.id)} onClick={onClose}>
                  {one.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
