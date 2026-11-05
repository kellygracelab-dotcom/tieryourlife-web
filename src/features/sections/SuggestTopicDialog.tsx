import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { useModal } from "../../ui/useModal";
import type { Section } from "./model";

/**
 * What "Suggest a topic" means: a topic is named or chosen in a list's
 * settings when it is published, so the way to one is a list in this
 * section. Nothing is made until the person asks for the list.
 */
export function SuggestTopicDialog({
  section,
  onClose,
}: {
  section: Pick<Section, "id" | "name">;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="dialog__title">
          {strings.sections.suggestTopic}
        </h2>
        <p className="dialog__body">{strings.sections.suggestTopicBody}</p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--text" onClick={onClose}>
            <span>{strings.admin.cancel}</span>
          </button>
          <Link
            className="btn btn--filled"
            to={`/b/new?category=${encodeURIComponent(section.id)}`}
          >
            <span>{fill(strings.sections.suggestTopicMake, { section: section.name })}</span>
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
