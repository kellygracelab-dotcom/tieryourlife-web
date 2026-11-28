import { describe, expect, it } from "vitest";
import { neededWidth } from "./coverSizes";

describe("neededWidth", () => {
  const tile = { width: 88, height: 124 };

  it("takes a covering poster as wide as its tile", () => {
    expect(neededWidth(tile, "cover", 2 / 3)).toBe(88);
  });

  it("takes a covering wide picture as wide as the tile's height makes it", () => {
    expect(neededWidth(tile, "cover", 1.5)).toBe(186);
    expect(neededWidth(tile, "cover", 1)).toBe(124);
  });

  it("takes a picture not loaded yet for a poster", () => {
    expect(neededWidth({ width: 40, height: 90 }, "cover", null)).toBe(60);
  });

  it("takes a stretched picture, placed at its focus, as wide as its box", () => {
    expect(neededWidth({ width: 300, height: 124 }, "fill", 1.5)).toBe(300);
  });
});
