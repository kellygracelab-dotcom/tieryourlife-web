import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { MAX_TITLE_LENGTH } from "../../api/boards";
import { strings } from "../../strings";
import { useModal } from "../../ui/useModal";
import "./board.css";

/**
 * Rename in a card's menu on one's own list (night pass W22): its name in a
 * field, chosen whole. Save or Enter keeps it; a name emptied, Cancel or
 * Escape leave the old one, as a list's name does.
 */
export function RenameCard({
  name,
  onRename,
  onClose,
}: {
  name: string;
  onRename: (title: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(name);
  useModal(box, onClose, ".rename-card__field");
  // The card's menu hands the focus back to its card as it goes, which is
  // after this window took it: the field takes it again once the menu is gone.
  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>(".rename-card__field")?.focus();
  }, []);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (next !== "" && next !== name) onRename(next);
    onClose();
  };

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
          {strings.card.renameTitle}
        </h2>
        <form className="rename-card" onSubmit={onSubmit}>
          <label className="editor__label" htmlFor={`${titleId}-field`}>
            {strings.card.nameLabel}
          </label>
          <input
            id={`${titleId}-field`}
            className="tier-dialog__input rename-card__field"
            type="text"
            value={value}
            maxLength={MAX_TITLE_LENGTH}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--text" onClick={onClose}>
              <span>{strings.rank.cancel}</span>
            </button>
            <button type="submit" className="btn btn--filled">
              <span>{strings.card.renameSave}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
