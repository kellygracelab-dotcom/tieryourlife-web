import { describe, expect, it } from "vitest";
import { B_LIGHT, OLD_B_LIGHT, shownLight } from "./tierColour";

describe("B's light colour (artboard 54)", () => {
  it("draws the old olive as the new gold, in any case, and every other colour as it is", () => {
    expect(shownLight(OLD_B_LIGHT)).toBe(B_LIGHT);
    expect(shownLight("#a98b1f")).toBe(B_LIGHT);
    expect(shownLight("#B03A32")).toBe("#B03A32");
    expect(shownLight("#D8C05A")).toBe("#D8C05A");
  });
});
