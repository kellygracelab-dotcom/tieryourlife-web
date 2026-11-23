import { describe, expect, it } from "vitest";
import { cardLabel, cardTitleOf, hasPicture, isNamed, OLD_UNNAMED } from "./cardText";

describe("a card's name", () => {
  it("reads the old default as no name on a card with a picture, in every language it was written in", () => {
    expect(OLD_UNNAMED.size).toBe(11);
    for (const old of OLD_UNNAMED) expect(cardTitleOf(old, true)).toBe("");
    expect(cardTitleOf("  Untitled card ", true)).toBe("");
    // A card with words only keeps them: it has nothing else to show.
    expect(cardTitleOf("Untitled card", false)).toBe("Untitled card");
    expect(cardTitleOf("Untitled cards", true)).toBe("Untitled cards");
    expect(cardTitleOf("Dune", true)).toBe("Dune");
  });

  it("knows a picture by a kept photo or an address", () => {
    expect(hasPicture({ imageUrl: "https://x/a.jpg" })).toBe(true);
    expect(hasPicture({ imageUrl: null, pictureId: "p1" })).toBe(true);
    expect(hasPicture({ imageUrl: null, pictureId: null })).toBe(false);
    expect(hasPicture({ imageUrl: "" })).toBe(false);
  });

  it("says Card where words are needed for one with no name", () => {
    expect(isNamed("  ")).toBe(false);
    expect(cardLabel("")).toBe("Card");
    expect(cardLabel(" ")).toBe("Card");
    expect(cardLabel("Dune")).toBe("Dune");
  });
});
