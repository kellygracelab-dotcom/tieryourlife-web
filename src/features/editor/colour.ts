import { TIER_PRESETS } from "./model";

/** "#RRGGBB", upper-case, or null for anything that is not six hex digits. */
export function hexOf(value: string): string | null {
  const digits = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(digits) ? `#${digits.toUpperCase()}` : null;
}

/** One of the eight pairs the editor offers, as against a colour of one's own. */
export function isPreset(colorLight: string, colorDark: string): boolean {
  return TIER_PRESETS.some(
    (preset) =>
      preset.light.toLowerCase() === colorLight.toLowerCase() &&
      preset.dark.toLowerCase() === colorDark.toLowerCase(),
  );
}

function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(hex: string): number {
  const digits = hex.replace(/^#/, "");
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast between two "#RRGGBB" colours, 1 to 21, the figure the phone
 * shows beside a custom colour: advisory, since a letter on a band is large.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminanceOf(foreground);
  const b = luminanceOf(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** What stands on a band in both themes: the letter is white there. */
export const ON_BAND = "#FFFFFF";
