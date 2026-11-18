/**
 * B's light colour before 18.11.2026 (artboard 54): olive, now gold. Lists
 * keep the colour they were saved with; the old default is drawn as the new
 * one wherever a tier's colour is shown, as the app does. The dark B stays.
 */
export const OLD_B_LIGHT = "#A98B1F";
export const B_LIGHT = "#B88A00";

/** A tier's light colour as it is drawn: the old B as the new, anything else as it is. */
export const shownLight = (hex: string): string =>
  hex.trim().toLowerCase() === OLD_B_LIGHT.toLowerCase() ? B_LIGHT : hex;
