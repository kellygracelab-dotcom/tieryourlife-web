import { describe, expect, it } from "vitest";
import { contrastRatio, hexOf, isPreset, ON_BAND } from "./colour";

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
