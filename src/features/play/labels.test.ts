import { describe, expect, it } from "vitest";
import { EVERYTHING } from "./chosen";
import { currentPair, newGame, pick, skip } from "./game";
import {
  bracketRoundText,
  duelText,
  estimateText,
  gameName,
  roundText,
  secondLine,
  startedText,
  thinText,
} from "./labels";
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

  it("names a bracket's round by the cards in it, a bye rounding up", () => {
    expect(bracketRoundText(2)).toBe("Final");
    expect(bracketRoundText(3)).toBe("Semi-finals");
    expect(bracketRoundText(4)).toBe("Semi-finals");
    expect(bracketRoundText(7)).toBe("Quarter-finals");
    expect(bracketRoundText(16)).toBe("Round of 16");
    expect(bracketRoundText(34)).toBe("Round of 64");
  });
});

describe("the line under the count", () => {
  const ids = ["a", "b", "c", "d"];
  const nameOf = (card: number) => ids[card]!.toUpperCase();

  it("says losers stay with its round", () => {
    expect(secondLine(newGame("swiss", ids, EVERYTHING, 1, 0), nameOf)).toBe(
      "Losers stay · Round 1 of 4",
    );
  });

  it("says the bracket's round", () => {
    expect(secondLine(newGame("bracket", ids, EVERYTHING, 1, 0), nameOf)).toBe("Semi-finals");
  });

  it("says the hill's name until a card has won twice in a row, then who holds it", () => {
    let game = newGame("hill", ids, EVERYTHING, 1, 0);
    expect(secondLine(game, nameOf)).toBe("King of the hill");
    game = pick(game, currentPair(game)![0]);
    expect(secondLine(game, nameOf)).toBe("King of the hill");
    game = pick(game, currentPair(game)![0]);
    expect(secondLine(game, nameOf)).toBe(`${nameOf(currentPair(game)![0])} has won 2 in a row`);
  });

  it("says the game's name while refining", () => {
    let game = newGame("bracket", ids, EVERYTHING, 1, 0);
    while (currentPair(game) !== null) game = skip(game);
    expect(secondLine({ ...game, refineFixed: { from: 3, pairs: [] } }, nameOf)).toBe("Bracket");
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
