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
  PRESET_HUES,
  readColour,
  shownColour,
  SITE_COLOURS,
  subscribeToColour,
  type SiteColour,
} from "../../lib/colourTheme";
import type { Roles } from "../../lib/palette";
import { shownScheme } from "../../lib/theme";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { onRadioKeys, radioTabIndex } from "../../ui/radioKeys";
import { useModal } from "../../ui/useModal";
import "./colour.css";

type Palette = typeof import("../../lib/palette");

/** The colour library, once it has come; the circles and the slider wait for it. */
function usePalette(): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    let alive = true;
    void import("../../lib/palette").then((module) => {
      if (alive) setPalette(module);
    });
    return () => {
      alive = false;
    };
  }, []);
  return palette;
}

/** A circle's two tones: the light scheme's container round its primary dot, the same light or dark. */
type Tones = { container: string; primary: string };

/** Lavender is drawn by hand: its light container and main button (tokens.css). */
const LAVENDER: Tones = { container: "#DEE0FF", primary: "#4A5BAA" };

const tonesOf = (roles: Roles): Tones => ({
  container: roles.primaryContainer,
  primary: roles.primary,
});

const nameOf = (colour: SiteColour): string => strings.colour[colour];

/** The rainbow the slider runs along until the colour library comes. */
const RAINBOW = [
  "#D98A8A",
  "#D9B77E",
  "#C9CF85",
  "#8FCB9B",
  "#86C2CF",
  "#8FA3DB",
  "#B79BD9",
  "#D98AB4",
  "#D98A8A",
];

/** How many grey cards stand in each row of the little sheet. */
const PLACEHOLDERS = { S: 3, A: 2, B: 1 } as const;

/**
 * Your colour (artboard 59): one slider of hue, and a small sheet above it
 * drawn in what it makes, in the scheme the site shows now. Lightness and
 * contrast are the algorithm's, so nothing unreadable can come out. Done
 * keeps it; Cancel leaves the colour.
 */
function OwnColour({
  first,
  palette,
  onDone,
  onClose,
}: {
  first: number;
  palette: Palette | null;
  onDone: (hue: number) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [hue, setHue] = useState(first);
  useModal(box, onClose, ".own-colour__hue");
  const dark = shownScheme() === "dark";
  const roles = palette?.rolesOf(hue, dark) ?? null;
  const ramp = palette?.hueRamp() ?? RAINBOW;
  const look = {
    "--own-ramp": `linear-gradient(to right, ${ramp.join(", ")})`,
    ...(roles === null
      ? {}
      : {
          "--own-paper": dark ? roles.surface : roles.surfaceContainerHigh,
          "--own-band-paper": dark ? roles.surfaceContainerLow : roles.surfaceContainerLowest,
          "--own-line": roles.outlineVariant,
          "--own-ink": roles.onSurface,
          "--own-card": roles.outline,
          "--own-button": roles.primary,
          "--own-on-button": roles.onPrimary,
        }),
  } as CSSProperties;
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
          <span className="own-colour__top">
            <span className="own-colour__heading" />
            <span className="own-colour__play">
              <Icon name="play_arrow" />
            </span>
          </span>
          {(["S", "A", "B"] as const).map((tier) => (
            <span
              key={tier}
              className="own-colour__row band"
              style={{ "--band-light": `var(--tier-${tier.toLowerCase()})` } as CSSProperties}
            >
              <span className="own-colour__letter">{tier}</span>
              {Array.from({ length: PLACEHOLDERS[tier] }, (_, at) => (
                <span key={at} className="own-colour__card" />
              ))}
            </span>
          ))}
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
          <button
            type="button"
            className="btn btn--filled own-colour__done"
            onClick={() => onDone(hue)}
          >
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
  const palette = usePalette();
  const ownHue = shown === "custom" ? (choice?.hue ?? null) : null;
  const tones = (colour: SiteColour): Tones | null => {
    if (colour === "lavender") return LAVENDER;
    if (palette === null) return null;
    if (colour !== "custom") return tonesOf(palette.rolesOf(PRESET_HUES[colour], false));
    // One's own circle is the wheel of hues until it is chosen, then two tones of its hue.
    return ownHue === null ? null : tonesOf(palette.rolesOf(ownHue, false));
  };
  // The slider opens on the hue the site is drawn in now; Lavender's is the phone's first own hue.
  const firstHue =
    shown === "custom" || shown === "lavender" ? (ownHue ?? FIRST_OWN_HUE) : PRESET_HUES[shown];
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
        {SITE_COLOURS.map((colour, at) => {
          const two = tones(colour);
          const chosen = shown === colour;
          const wheel = colour === "custom" && two === null;
          return (
            <button
              key={colour}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={nameOf(colour)}
              tabIndex={radioTabIndex(chosen, at === 0, false)}
              className={`colour__swatch${wheel ? " colour__swatch--wheel" : ""}`}
              onClick={() => (colour === "custom" ? setOwn(true) : chooseColour(colour, null))}
            >
              <span
                className="colour__disc"
                style={
                  two === null
                    ? undefined
                    : ({
                        "--swatch-container": two.container,
                        "--swatch-primary": two.primary,
                      } as CSSProperties)
                }
              >
                <span className="colour__dot">
                  {colour === "custom" ? (
                    <Icon name="edit" className="colour__mark" />
                  ) : (
                    chosen && <Icon name="check" className="colour__mark" />
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="settings__note">
        {strings.colour.note}
        {signedIn && ` ${strings.colour.follows}`}
      </p>
      {own && (
        <OwnColour
          first={firstHue}
          palette={palette}
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
