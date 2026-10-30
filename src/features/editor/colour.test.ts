import { describe, expect, it } from "vitest";
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

describe("a tier colour of one's own", () => {
  it("reads six hex digits with or without the hash, and nothing else", () => {
    expect(hexOf("#b03a32")).toBe("#B03A32");
    expect(hexOf(" 3c6e99 ")).toBe("#3C6E99");
    expect(hexOf("#fff")).toBeNull();
    expect(hexOf("#GGGGGG")).toBeNull();
    expect(hexOf("")).toBeNull();
  });

  it("tells a preset pair from a custom one, whatever the case", () => {
    expect(isPreset("#b03a32", "#F1948C")).toBe(true);
    expect(isPreset("#B03A32", "#000000")).toBe(false);
  });

  it("measures contrast the WCAG way: 21 for black on white, 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // The first preset's light band under a white letter.
    expect(contrastRatio(ON_BAND, "#B03A32")).toBeCloseTo(6.0, 1);
    expect(contrastRatio("#B03A32", ON_BAND)).toBe(contrastRatio(ON_BAND, "#B03A32"));
  });
});

describe("a tier's dark colour, made from its light one", () => {
  it("keeps the hue and lightens it to the dark theme's band, the letter readable on it", () => {
    for (const preset of TIER_PRESETS) {
      const dark = darkOf(preset.light);
      expect(dark).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrastRatio(DARK_LETTER, dark)).toBeGreaterThan(READABLE_FROM);
      // The hue stays within a few degrees of the light colour's.
      const shift = Math.abs(hueToneOf(dark).hue - hueToneOf(preset.light).hue);
      expect(Math.min(shift, 360 - shift)).toBeLessThan(12);
    }
    // A grey stays grey, whatever its lightness.
    expect(darkOf("#808080")).toBe(darkOf("#404040"));
  });

  it("finds a colour on screen for a hue the screen cannot show that bright", () => {
    expect(darkOf("#0000FF")).toMatch(/^#[0-9A-F]{6}$/);
    expect(darkOf("#00FF00")).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("the hue and tone picker's colours", () => {
  it("goes from a hue and a lightness to a colour and back", () => {
    for (const hue of [0, 45, 100, 170, 220, 300, 359]) {
      const back = hueToneOf(hexOfHueTone(hue, 45));
      expect(Math.abs(back.hue - hue)).toBeLessThan(2);
      expect(Math.abs(back.tone - 45)).toBeLessThan(1);
    }
    expect(hexOfHueTone(0, 100)).toBe("#FFFFFF");
    expect(hexOfHueTone(-120, 0)).toBe("#000000");
    expect(hueToneOf("#777777").hue).toBe(0);
    // A light yellow under a white letter is hard to read.
    expect(contrastRatio(ON_BAND, hexOfHueTone(60, 70))).toBeLessThan(READABLE_FROM);
  });
});
