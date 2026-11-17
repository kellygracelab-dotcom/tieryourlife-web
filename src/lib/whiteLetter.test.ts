import { describe, expect, it } from "vitest";
import { forWhiteLetter, whiteContrast, WHITE_LETTER_FROM } from "./whiteLetter";

const rgbOf = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

describe("a tier's colour under a white letter (artboard 18)", () => {
  it("darkens A's orange and B's ochre until the letter reads, the hue kept", () => {
    for (const light of ["#C06A25", "#A98B1F"]) {
      const dark = forWhiteLetter(light);
      expect(whiteContrast(rgbOf(dark))).toBeGreaterThanOrEqual(WHITE_LETTER_FROM);
      expect(whiteContrast(rgbOf(dark))).toBeLessThan(WHITE_LETTER_FROM + 0.6);
    }
  });

  it("leaves a colour dark enough already as it is", () => {
    expect(forWhiteLetter("#B03A32")).toBe("#B03A32");
    expect(forWhiteLetter("#3C6E99")).toBe("#3C6E99");
  });

  it("passes on what is not a colour", () => {
    expect(forWhiteLetter("tomato")).toBe("tomato");
  });
});
