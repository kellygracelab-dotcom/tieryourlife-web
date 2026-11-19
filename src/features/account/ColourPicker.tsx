import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  chooseColour,
  colourVersion,
  FIRST_OWN_HUE,
  readColour,
  shownColour,
  SITE_COLOURS,
  subscribeToColour,
  type SiteColour,
} from "../../lib/colourTheme";
import type { Roles } from "../../lib/palette";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { onRadioKeys, radioTabIndex } from "../../ui/radioKeys";
import { useModal } from "../../ui/useModal";
import "./colour.css";

/** Each ready colour's main button in the light, from the shared vectors; Lavender's is the site's own blue. */
const SWATCH: Record<Exclude<SiteColour, "custom">, string> = {
  lavender: "#4A5BAA",
  matcha: "#536525",
  peach: "#8E4D2F",
  sky: "#006875",
};

const nameOf = (colour: SiteColour): string => strings.colour[colour];

/** The palette of a hue, built once the colour library has come. */
function useRoles(hue: number | null): Roles | null {
  const [roles, setRoles] = useState<Roles | null>(null);
  useEffect(() => {
    let alive = true;
    if (hue === null) return;
    void import("../../lib/palette").then(({ rolesOf }) => {
      if (alive) setRoles(rolesOf(hue, false));
    });
    return () => {
      alive = false;
    };
  }, [hue]);
  // No hue, no palette; while a new hue's palette is built, the last one stays.
  return hue === null ? null : roles;
}

/**
 * Your colour (artboard 59): one slider of hue, and a small list above it
 * drawn in what it makes. Lightness and contrast are the algorithm's, so
 * nothing unreadable can come out. Done keeps it; Cancel leaves the colour.
 */
function OwnColour({
  first,
  onDone,
  onClose,
}: {
  first: number;
  onDone: (hue: number) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [hue, setHue] = useState(first);
  const roles = useRoles(hue);
  useModal(box, onClose, ".own-colour__hue");
  const look =
    roles === null
      ? undefined
      : ({
          "--own-paper": roles.surfaceContainerHigh,
          "--own-card": roles.surfaceContainerLow,
          "--own-ink": roles.onSurface,
          "--own-button": roles.primary,
          "--own-on-button": roles.onPrimary,
          "--own-row": roles.surfaceContainerLowest,
        } as CSSProperties);
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow own-colour"
        style={look}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="dialog__title">
          {strings.colour.yourColour}
        </h2>
        <p className="own-colour__text">{strings.colour.yourColourText}</p>
        <div className="own-colour__preview" aria-hidden="true">
          {(["S", "A", "B"] as const).map((tier) => (
            <span key={tier} className={`own-colour__row own-colour__row--${tier.toLowerCase()}`}>
              <span className="own-colour__letter">{tier}</span>
            </span>
          ))}
          <span className="own-colour__button" />
        </div>
        <input
          className="own-colour__hue"
          type="range"
          min={0}
          max={359}
          step={1}
          value={hue}
          aria-label={strings.colour.hue}
          onChange={(event) => setHue(Number(event.target.value))}
        />
        <div className="dialog__actions">
          <button type="button" className="btn btn--text" onClick={onClose}>
            <span>{strings.colour.cancel}</span>
          </button>
          <button type="button" className="btn btn--filled" onClick={() => onDone(hue)}>
            <span>{strings.colour.done}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Colour, under the theme (artboards 58–59): Lavender, Matcha, Peach, Sky and
 * one's own. A press recolours the whole site at once, light and dark; the
 * tiers keep their colours. Signed in, the account carries it to the phone.
 */
export function ColourPicker({ signedIn }: { signedIn: boolean }) {
  useSyncExternalStore(subscribeToColour, colourVersion);
  const choice = readColour();
  const shown = shownColour(choice);
  const [own, setOwn] = useState(false);
  // One's own circle is the wheel of hues until a hue was chosen, then that hue's button, as on the phone.
  const ownRoles = useRoles(choice?.hue ?? null);
  return (
    <div className="colour">
      <p className="colour__title">
        <span>{strings.colour.title}</span>
        <span className="colour__name">{nameOf(shown)}</span>
      </p>
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
      <div
        className="colour__options"
        role="radiogroup"
        aria-label={strings.colour.title}
        onKeyDown={(event) => onRadioKeys(event)}
      >
        {SITE_COLOURS.map((colour, at) => (
          <button
            key={colour}
            type="button"
            role="radio"
            aria-checked={shown === colour}
            aria-label={nameOf(colour)}
            tabIndex={radioTabIndex(shown === colour, at === 0, false)}
            className={`colour__swatch colour__swatch--${colour}`}
            style={
              colour !== "custom"
                ? { background: SWATCH[colour] }
                : ownRoles === null
                  ? undefined
                  : { background: ownRoles.primary }
            }
            onClick={() => (colour === "custom" ? setOwn(true) : chooseColour(colour, null))}
          >
            {shown === colour && <Icon name="check" className="colour__check" />}
          </button>
        ))}
      </div>
      <p className="settings__note">
        {strings.colour.note}
        {signedIn && ` ${strings.colour.follows}`}
      </p>
      {own && (
        <OwnColour
          first={choice?.hue ?? FIRST_OWN_HUE}
          onClose={() => setOwn(false)}
          onDone={(hue) => {
            setOwn(false);
            chooseColour("custom", hue);
          }}
        />
      )}
    </div>
  );
}
