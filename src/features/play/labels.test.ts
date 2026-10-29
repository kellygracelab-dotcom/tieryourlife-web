import { describe, expect, it } from "vitest";
import { duelText, estimateText, gameName, roundText, startedText, thinText } from "./labels";
import { fittedSize } from "./useFitText";

const main = { phase: "main" as const, round: null, overall: { asked: 0, total: 0 } };

describe("the words of a game", () => {
  it("names the games", () => {
    expect(gameName("swiss")).toBe("Losers stay");
    expect(gameName("hill")).toBe("King of the hill");
    expect(gameName("bracket")).toBe("Bracket");
  });

  it("says the estimate, losers stay as an upper bound", () => {
    expect(estimateText("swiss", 34)).toBe("≈ 136 duels · about 5 min");
    expect(estimateText("hill", 34)).toBe("33 duels · about 1 min");
  });

  it("counts the duel being asked from one, and refine on its own", () => {
    expect(duelText({ ...main, asked: 11, total: 136 })).toBe("Duel 12 of 136");
    expect(duelText({ ...main, asked: 136, total: 136 })).toBe("Duel 136 of 136");
    expect(duelText({ ...main, phase: "refine", asked: 3, total: 17 })).toBe("Refine · 4 of 17");
  });

  it("says the round of losers stay only", () => {
    expect(roundText({ ...main, asked: 0, total: 1, round: { n: 3, of: 8 } })).toBe("Round 3 of 8");
    expect(roundText({ ...main, asked: 0, total: 1 })).toBeNull();
  });

  it("says when a game started by the calendar", () => {
    const now = new Date(2026, 9, 28, 9, 0).getTime();
    expect(startedText(new Date(2026, 9, 28, 0, 30).getTime(), now)).toBe("Started today");
    expect(startedText(new Date(2026, 9, 27, 23, 0).getTime(), now)).toBe("Started yesterday");
    expect(startedText(new Date(2026, 9, 24, 12, 0).getTime(), now)).toBe("Started 4 days ago");
  });
});

describe("the thin banner", () => {
  it("is plural by the guesses and by the duels Refine adds", () => {
    expect(thinText(6, 17)).toBe(
      "6 cards played fewer than 2 duels, so their places are a guess. Refine adds up to 17 duels for them, or apply now and adjust by hand.",
    );
    expect(thinText(1, 1)).toBe(
      "1 card played fewer than 2 duels, so its place is a guess. Refine adds up to 1 duel for it, or apply now and adjust by hand.",
    );
  });

  it("only says to adjust by hand once Refine is used", () => {
    expect(thinText(2, 0)).toBe(
      "2 cards played fewer than 2 duels, so their places are a guess. Apply now and adjust by hand.",
    );
  });
});

describe("a name shrunk to fit", () => {
  it("is the largest size that fits, from 22 down to 14", () => {
    expect(fittedSize(() => true)).toBe(22);
    expect(fittedSize((size) => size <= 17)).toBe(17);
    expect(fittedSize(() => false)).toBe(14);
  });
});
