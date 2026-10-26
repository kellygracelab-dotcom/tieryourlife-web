import { useState } from "react";
import { fill, strings } from "../../strings";
import { contrastRatio, hexOf, isPreset, ON_BAND } from "./colour";
import { TIER_PRESETS } from "./model";

/**
 * A tier's colour: the phone's presets, and the person's own pair of colours
 * for the light and the dark theme. Shared by the tier list and the tier's
 * own editor.
 */
export function TierColours({
  colorLight,
  colorDark,
  onChange,
  onPreset,
}: {
  colorLight: string;
  colorDark: string;
  onChange: (colorLight: string, colorDark: string) => void;
  /** After a preset is picked: the tier list closes its palette. */
  onPreset?: () => void;
}) {
  const usesPreset = isPreset(colorLight, colorDark);
  // The custom panel opens by itself for a colour that is already one's own.
  const [customOpen, setCustomOpen] = useState(() => !usesPreset);
  return (
    <div className="tiers__palette" role="group" aria-label={strings.new.palette}>
      {TIER_PRESETS.map((preset) => (
        <button
          key={preset.light}
          type="button"
          className="tiers__preset"
          style={{ background: preset.light }}
          aria-label={preset.light}
          aria-pressed={preset.light.toLowerCase() === colorLight.toLowerCase()}
          onClick={() => {
            onChange(preset.light, preset.dark);
            setCustomOpen(false);
            onPreset?.();
          }}
        />
      ))}
      <button
        type="button"
        className="tiers__preset tiers__preset--custom"
        aria-label={strings.new.customColour}
        aria-pressed={!usesPreset}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      />
      {customOpen && (
        <div className="tiers__custom">
          <p className="tiers__custom-note">{strings.new.customColourNote}</p>
          <ColourField
            theme="light"
            value={colorLight}
            onChange={(hex) => onChange(hex, colorDark)}
          />
          <ColourField
            theme="dark"
            value={colorDark}
            onChange={(hex) => onChange(colorLight, hex)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One of the two colours of a tier: the browser's own picker, the hex spelled
 * out for anybody who has one, and the contrast of a white letter on it, the
 * figure the phone shows. The hex is taken on Enter or when the field is left;
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
  return (
    <div className="tiers__custom-field">
      <span className="tiers__custom-theme">{themeName}</span>
      <input
        type="color"
        className="tiers__custom-swatch"
        value={value.toLowerCase()}
        aria-label={fill(strings.new.colourField, { theme: themeName })}
        onChange={(event) => take(hexOf(event.target.value) ?? value.toUpperCase())}
      />
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
      <span className="tiers__contrast">
        {fill(strings.new.contrast, { ratio: contrastRatio(ON_BAND, value).toFixed(1) })}
      </span>
    </div>
  );
}
