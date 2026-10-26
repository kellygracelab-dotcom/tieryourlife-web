import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import { LIMITS, type EditorAction, type EditorTier } from "./model";
import { TierColours } from "./TierColours";
import "./editor.css";

interface TierDialogProps {
  tier: EditorTier;
  /** A board keeps one tier at least. */
  canRemove: boolean;
  dispatch: (action: EditorAction) => void;
  onClose: () => void;
}

/**
 * One tier, opened from the board by a double tap or its pencil: its letter,
 * its caption and its colour, as the phone's sheet has them, and nothing
 * changes on the board until Save.
 */
export function TierDialog({ tier, canRemove, dispatch, onClose }: TierDialogProps) {
  const id = useId();
  const box = useRef<HTMLFormElement>(null);
  const [label, setLabel] = useState(tier.label);
  const [caption, setCaption] = useState(tier.caption ?? "");
  const [colours, setColours] = useState({ light: tier.colorLight, dark: tier.colorDark });
  useModal(box, onClose, "input");

  const named = label.trim().length > 0;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!named) return;
    dispatch({ type: "renameTier", key: tier.key, label: label.trim(), caption: caption.trim() });
    if (colours.light !== tier.colorLight || colours.dark !== tier.colorDark) {
      dispatch({
        type: "recolourTier",
        key: tier.key,
        colorLight: colours.light,
        colorDark: colours.dark,
      });
    }
    onClose();
  };
  const remove = () => {
    dispatch({ type: "removeTier", key: tier.key });
    onClose();
  };

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <form
        ref={box}
        className="dialog tier-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {strings.boards.editTier}
        </h2>
        <div
          className="tier-dialog__preview band"
          style={{ "--band-light": colours.light, "--band-dark": colours.dark } as CSSProperties}
          aria-hidden="true"
        >
          <span className="tier-dialog__letter">{label}</span>
          {caption.trim().length > 0 && <span className="tier-dialog__caption">{caption}</span>}
        </div>
        <label className="tier-dialog__field">
          <span>{strings.boards.tierName}</span>
          <input
            className="tier-dialog__input"
            value={label}
            maxLength={LIMITS.label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="tier-dialog__field">
          <span>{strings.boards.tierCaption}</span>
          <input
            className="tier-dialog__input"
            value={caption}
            maxLength={LIMITS.caption}
            placeholder={strings.new.captionPlaceholder}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <TierColours
          colorLight={colours.light}
          colorDark={colours.dark}
          onChange={(light, dark) => setColours({ light, dark })}
        />
        <div className="dialog__actions">
          {canRemove && (
            <Button className="dialog__danger tier-dialog__remove" onClick={remove}>
              {fill(strings.new.removeTier, { name: tier.label })}
            </Button>
          )}
          <Button onClick={onClose}>{strings.rank.cancel}</Button>
          <Button variant="filled" type="submit" disabled={!named}>
            {strings.boards.save}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
