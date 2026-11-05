import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useModal } from "../../ui/useModal";
import { DOUBLE_TAP_MS } from "../tierboard/drag";
import { TierLabel } from "../tierboard/TierLabel";
import { LIMITS, type EditorAction, type EditorTier } from "./model";
import { TierColours } from "./TierColours";
import "./editor.css";

/** The counter under a field shows once this few characters are left: the backend's limits are long. */
const COUNT_FROM = 20;

/** How many characters a field holds of how many, once it is near its limit. */
function Counter({ length, max }: { length: number; max: number }) {
  if (max - length > COUNT_FROM) return null;
  return (
    <span
      className={
        length >= max ? "tier-dialog__counter tier-dialog__counter--full" : "tier-dialog__counter"
      }
      aria-hidden="true"
    >
      {fill(strings.settings.nameCounter, { n: length, max })}
    </span>
  );
}

interface TierDialogProps {
  tier: EditorTier;
  /**
   * New: the tier does not exist yet, and comes into being on "Add tier".
   * Edit: a tier on the board, changed on Save, taken away or moved from here.
   */
  mode: "new" | "edit";
  /** A board keeps one tier at least. */
  canRemove: boolean;
  /** Where the tier stands, for Move up and Move down; absent in New. */
  place?: { index: number; count: number };
  dispatch: (action: EditorAction) => void;
  onClose: () => void;
}

/**
 * One tier, as the phone's sheet has it: its letter and caption side by side,
 * how it looks in the light and the dark, and its colour. Opened from the
 * board by a double click, a tap, its pencil or Add tier; nothing about the
 * tier changes on the board until Save, and a new one exists only after Add
 * tier. A dialog on a wide window, a sheet from the bottom on a phone.
 */
export function TierDialog({ tier, mode, canRemove, place, dispatch, onClose }: TierDialogProps) {
  const id = useId();
  const box = useRef<HTMLFormElement>(null);
  const [label, setLabel] = useState(tier.label);
  const [caption, setCaption] = useState(tier.caption ?? "");
  const [colours, setColours] = useState({ light: tier.colorLight, dark: tier.colorDark });
  useModal(box, onClose, "input");
  // A double tap on a band, the habit of a phone, opens the editor with its
  // first tap; its second must not land on the scrim and close it again, nor
  // on a swatch or the colour field that the sheet put under the finger.
  const [openedAt] = useState(() => Date.now());
  // The finger of that second tap, ignored until its click is over.
  const ignored = useRef<number | null>(null);
  // Typing first means the person is already at work in the sheet: the tap
  // that follows is meant, however quick.
  const working = useRef(false);
  const swallow = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const secondTap = {
    onPointerDownCapture: (event: PointerEvent) => {
      // Only a band opens the editor on a tap; Add tier is a button pressed once.
      const second =
        mode === "edit" &&
        !working.current &&
        event.pointerType === "touch" &&
        Date.now() - openedAt < DOUBLE_TAP_MS;
      ignored.current = second ? event.pointerId : null;
      if (second) swallow(event);
    },
    onPointerMoveCapture: (event: PointerEvent) => {
      if (ignored.current !== null && event.pointerId === ignored.current) event.stopPropagation();
    },
    onInputCapture: () => {
      working.current = true;
    },
    onKeyDownCapture: () => {
      working.current = true;
    },
    onClickCapture: (event: MouseEvent) => {
      if (ignored.current !== null) swallow(event);
      ignored.current = null;
    },
  };

  const named = label.trim().length > 0;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!named) return;
    const shown = caption.trim();
    if (mode === "new") {
      dispatch({
        type: "addTier",
        tier: {
          label: label.trim(),
          caption: shown.length > 0 ? shown : null,
          colorLight: colours.light,
          colorDark: colours.dark,
        },
      });
      onClose();
      return;
    }
    dispatch({ type: "renameTier", key: tier.key, label: label.trim(), caption: shown });
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
  const preview = (theme: "light" | "dark") => (
    <figure className={`tier-dialog__theme tier-dialog__theme--${theme}`}>
      <figcaption className="tier-dialog__theme-name">
        {theme === "light" ? strings.new.lightColour : strings.new.darkColour}
      </figcaption>
      <div
        className="tier-dialog__preview"
        style={
          { "--preview-band": theme === "light" ? colours.light : colours.dark } as CSSProperties
        }
        aria-hidden="true"
      >
        <span className="tier-dialog__band">
          <TierLabel
            className="tier-dialog__letter"
            label={label}
            caption={caption.trim().length > 0 ? caption : null}
            band="preview"
          />
          {caption.trim().length > 0 && <span className="tier-dialog__caption">{caption}</span>}
        </span>
      </div>
    </figure>
  );

  return createPortal(
    <div
      className="scrim tier-dialog__scrim"
      onClick={() => {
        if (Date.now() - openedAt >= DOUBLE_TAP_MS) onClose();
      }}
    >
      <form
        ref={box}
        className="dialog tier-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        {...secondTap}
        onClick={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <span className="tier-dialog__handle" aria-hidden="true" />
        <h2 id={`${id}-title`} className="dialog__title">
          {mode === "new" ? strings.boards.newTier : strings.boards.editTier}
        </h2>
        <div className="tier-dialog__previews">
          {preview("light")}
          {preview("dark")}
        </div>
        <div className="tier-dialog__fields">
          <label className="tier-dialog__field tier-dialog__field--label">
            <span>{strings.boards.tierName}</span>
            <input
              className="tier-dialog__input"
              value={label}
              maxLength={LIMITS.label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Counter length={label.length} max={LIMITS.label} />
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
            <Counter length={caption.length} max={LIMITS.caption} />
          </label>
        </div>
        <TierColours
          colorLight={colours.light}
          colorDark={colours.dark}
          onChange={(light, dark) => setColours({ light, dark })}
        />
        <div className="dialog__actions tier-dialog__actions">
          {mode === "edit" && canRemove && (
            <Button className="tier-dialog__remove" onClick={remove}>
              {strings.boards.removeTier}
            </Button>
          )}
          {/* Greyed out at either end but still focusable: a move to the top keeps the keyboard on it. */}
          {mode === "edit" && place !== undefined && (
            <span className="tier-dialog__moves">
              <button
                type="button"
                className="tier-dialog__move"
                aria-label={fill(strings.new.moveUp, { name: tier.label })}
                aria-disabled={place.index === 0}
                onClick={() => {
                  if (place.index > 0) dispatch({ type: "moveTier", key: tier.key, by: -1 });
                }}
              >
                <Icon name="arrow_upward" />
              </button>
              <button
                type="button"
                className="tier-dialog__move"
                aria-label={fill(strings.new.moveDown, { name: tier.label })}
                aria-disabled={place.index >= place.count - 1}
                onClick={() => {
                  if (place.index < place.count - 1) {
                    dispatch({ type: "moveTier", key: tier.key, by: 1 });
                  }
                }}
              >
                <Icon name="arrow_downward" />
              </button>
            </span>
          )}
          <span className="tier-dialog__end">
            <Button onClick={onClose}>{strings.rank.cancel}</Button>
            <Button variant="filled" type="submit" disabled={!named}>
              {mode === "new" ? strings.new.addTier : strings.boards.save}
            </Button>
          </span>
        </div>
      </form>
    </div>,
    document.body,
  );
}
