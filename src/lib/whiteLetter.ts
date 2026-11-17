/**
 * A tier's light colour as a button with a white letter needs it (artboard
 * 18): A's orange and B's ochre left the letter at 3.9 and 3.3 to 1. The
 * colour is darkened, its hue kept, until the letter reaches 5 to 1; one dark
 * enough already is left as it is. #C06A25 comes out near the design's #A9561B.
 */
export const WHITE_LETTER_FROM = 5;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(rgb: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((c) => linear(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast of a white letter on "#RRGGBB", 1 to 21. */
export const whiteContrast = (rgb: readonly number[]): number => 1.05 / (luminance(rgb) + 0.05);

export function forWhiteLetter(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return hex;
  const digits = match[1]!;
  const rgb = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
  if (whiteContrast(rgb) >= WHITE_LETTER_FROM) return hex;
  for (let k = 0.98; k > 0; k -= 0.02) {
    const darker = rgb.map((c) => Math.round(c * k));
    if (whiteContrast(darker) >= WHITE_LETTER_FROM) {
      return `#${darker.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    }
  }
  return "#000000";
}
