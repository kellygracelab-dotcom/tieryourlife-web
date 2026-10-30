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

/** What stands on a tier's dark colour: a near-black letter, the app's. */
export const DARK_LETTER = "#121318";

/** Below this a band's letter is hard to read, and the editor says so. */
export const READABLE_FROM = 3;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbOf(hex: string): [number, number, number] {
  const digits = hex.replace(/^#/, "");
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function hexOfRgb(rgb: readonly number[]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** sRGB to OKLab (Björn Ottosson's matrices). */
function oklabOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB, each channel 0 to 1, possibly outside the screen's range. */
function rgbOfOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * The dark theme's colour for a tier, made from its light one as the designer
 * gives it: the same hue, OKLab lightness 0.80, chroma down to 85%, and less
 * still where the screen has no such colour.
 */
export function darkOf(light: string): string {
  const [, a, b] = oklabOf(light);
  for (let k = 0.85; k > 0; k -= 0.01) {
    const rgb = rgbOfOklab(0.8, a * k, b * k);
    if (rgb.every((c) => c >= -0.0005 && c <= 1.0005)) return hexOfRgb(rgb);
  }
  return hexOfRgb(rgbOfOklab(0.8, 0, 0));
}

/** "#RRGGBB" as hue (0–360) and lightness (0–100), for the hue and tone picker. */
export function hueToneOf(hex: string): { hue: number; tone: number } {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const tone = ((max + min) / 2) * 100;
  if (max === min) return { hue: 0, tone };
  const d = max - min;
  const hue =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return { hue, tone };
}

/** The picker's colour at a hue and a lightness: one saturation, a band's strength. */
export const PICKER_SATURATION = 0.7;

export function hexOfHueTone(hue: number, tone: number): string {
  const l = Math.min(100, Math.max(0, tone)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * PICKER_SATURATION;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return hexOfRgb([r + m, g + m, b + m]);
}
