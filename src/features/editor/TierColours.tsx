import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import {
  contrastRatio,
  DARK_LETTER,
  darkOf,
  hexOf,
  hexOfHueTone,
  hueToneOf,
  isPreset,
  ON_BAND,
  READABLE_FROM,
} from "./colour";
import { TIER_PRESETS } from "./model";

/**
 * A tier's colour, as the designer has it (walk 3, B): the phone's eight
 * presets and one of one's own. One's own is a single picker and its hex; the
 * dark theme's colour follows from it (`darkOf`) unless it is set apart. A
 * line says so when the letter would be hard to read on either.
 */
export function TierColours({
  colorLight,
  colorDark,
  onChange,
}: {
  colorLight: string;
  colorDark: string;
  onChange: (colorLight: string, colorDark: string) => void;
}) {
  const usesPreset = isPreset(colorLight, colorDark);
  // The custom panel opens by itself for a colour that is already one's own,
  // and a dark colour that is not the light one's own was set apart.
  const [customOpen, setCustomOpen] = useState(() => !usesPreset);
  const [darkApart, setDarkApart] = useState(
    () => !usesPreset && darkOf(colorLight).toLowerCase() !== colorDark.toLowerCase(),
  );
  const hard =
    contrastRatio(ON_BAND, colorLight) < READABLE_FROM ||
    contrastRatio(DARK_LETTER, colorDark) < READABLE_FROM;
  return (
    <div className="tiers__palette" role="group" aria-label={strings.new.palette}>
      <div className="tiers__swatches">
        {TIER_PRESETS.map((preset) => {
          const chosen =
            preset.light.toLowerCase() === colorLight.toLowerCase() &&
            preset.dark.toLowerCase() === colorDark.toLowerCase();
          return (
            <button
              key={preset.light}
              type="button"
              className="tiers__preset"
              style={{ background: preset.light }}
              aria-label={preset.light}
              aria-pressed={chosen}
              onClick={() => {
                onChange(preset.light, preset.dark);
                setCustomOpen(false);
                setDarkApart(false);
              }}
            >
              {chosen && <Icon name="check" />}
            </button>
          );
        })}
        <button
          type="button"
          className="tiers__preset tiers__preset--custom"
          aria-label={strings.new.customColour}
          aria-pressed={!usesPreset}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
        >
          <Icon name={usesPreset ? "palette" : "check"} />
        </button>
      </div>
      {customOpen && (
        <div className="tiers__custom">
          <ColourField
            theme="light"
            value={colorLight}
            onChange={(hex) => onChange(hex, darkApart ? colorDark : darkOf(hex))}
          />
          {darkApart ? (
            <ColourField
              theme="dark"
              value={colorDark}
              onChange={(hex) => onChange(colorLight, hex)}
            />
          ) : (
            <button
              type="button"
              className="btn btn--text tiers__dark-apart"
              onClick={() => setDarkApart(true)}
            >
              <span>{strings.new.darkSeparately}</span>
            </button>
          )}
        </div>
      )}
      {hard && <p className="tiers__warning">{strings.new.hardToRead}</p>}
    </div>
  );
}

/** How far an arrow key moves the picker: a hue step, a tone step. */
const HUE_STEP = 5;
const TONE_STEP = 4;
/** The picker's tones, top to bottom: light enough for a pastel, dark enough for a band. */
const TONE_TOP = 85;
const TONE_BOTTOM = 20;

const toneAt = (y: number) => TONE_TOP - y * (TONE_TOP - TONE_BOTTOM);
const yOf = (tone: number) =>
  Math.min(1, Math.max(0, (TONE_TOP - tone) / (TONE_TOP - TONE_BOTTOM)));

/**
 * One of a tier's two colours: a field of hues across and tones down, and the
 * hex spelled out for anybody who has one. The field takes a press and a drag,
 * and the arrow keys; the hex is taken on Enter or when the field is left, and
 * anything that is not six digits snaps back.
 */
function ColourField({
  theme,
  value,
  onChange,
}: {
  theme: "light" | "dark";
  value: string;
  onChange: (hex: string) => void;
}) {
  const themeName = theme === "light" ? strings.new.lightColour : strings.new.darkColour;
  // What is typed stays the field's own until it is a colour; the two ways the
  // colour changes from inside the field keep the text in step with it.
  const [typed, setTyped] = useState(value.toUpperCase());
  const take = (hex: string) => {
    setTyped(hex);
    if (hex !== value.toUpperCase()) onChange(hex);
  };
  const commit = () => {
    const hex = hexOf(typed);
    if (hex === null) setTyped(value.toUpperCase());
    else take(hex);
  };
  const { hue, tone } = hueToneOf(value);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const field = event.currentTarget;
    const box = field.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    // Hue runs with the reading direction: red at the start in Arabic too.
    const rtl = getComputedStyle(field).direction === "rtl";
    take(hexOfHueTone((rtl ? 1 - x : x) * 360, toneAt(y)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const along = rtl ? -1 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [HUE_STEP * along, 0],
      ArrowLeft: [-HUE_STEP * along, 0],
      ArrowUp: [0, TONE_STEP],
      ArrowDown: [0, -TONE_STEP],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const nextTone = Math.min(TONE_TOP, Math.max(TONE_BOTTOM, tone + move[1]));
    take(hexOfHueTone(hue + move[0], nextTone));
  };
  return (
    <div className="tiers__custom-field">
      <span className="tiers__custom-theme">{themeName}</span>
      <div
        className="tiers__tones"
        role="slider"
        tabIndex={0}
        aria-label={fill(strings.new.colourField, { theme: themeName })}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hue)}
        aria-valuetext={value.toUpperCase()}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) pick(event);
        }}
        onKeyDown={onKey}
      >
        <span
          className="tiers__tones-mark"
          style={{
            insetInlineStart: `${(hue / 360) * 100}%`,
            top: `${yOf(tone) * 100}%`,
            background: value,
          }}
          aria-hidden="true"
        />
      </div>
      <input
        type="text"
        className="tiers__hex"
        value={typed}
        aria-label={fill(strings.new.hexField, { theme: themeName })}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </div>
  );
}
