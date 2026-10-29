import { describe, expect, it } from "vitest";
import {
  duels,
  duelsPlayed,
  isOver,
  nextPair,
  outcomeOf,
  progress,
  refinePairs,
  result,
  swissRounds,
  type GameKind,
  type GameProgress,
  type GameSpec,
  type Outcome,
  type Pair,
} from "./games";
import { shuffled } from "./mulberry32";
import { duelsPerCard, standing } from "./strength";
import { SOLID_DUELS, THIN_GROUPS } from "./tiers";

const game = (kind: GameKind, count: number, seed: number, refine = false): GameSpec => ({
  kind,
  count,
  seed,
  refine,
});

const lowerWins = ([first, second]: Pair) => Math.min(first, second);
const higherWins = ([first, second]: Pair) => Math.max(first, second);

/** Plays a game to the end, noting its progress before every answer and once it is over. */
function playOut(spec: GameSpec, answer: (pair: Pair) => number | null) {
  const history: Outcome[] = [];
  const progressions: GameProgress[] = [progress(spec, history)];
  for (let pair = nextPair(spec, history); pair !== null; pair = nextPair(spec, history)) {
    history.push(outcomeOf(pair, answer(pair)));
    progressions.push(progress(spec, history));
  }
  return { history, progressions };
}

const pairsOf = (history: readonly Outcome[]) =>
  history.map(([first, second]) => [first, second].sort((a, b) => a - b).join("-"));

describe("hill", () => {
  it("asks one duel per challenger, and the winner stays", () => {
    const spec = game("hill", 5, 2);
    const order = shuffled(5, 2);
    expect(nextPair(spec, [])).toEqual([order[0], order[1]]);
    expect(nextPair(spec, [[order[0]!, order[1]!, order[1]!]])).toEqual([order[1], order[2]]);
    expect(playOut(spec, lowerWins).history).toHaveLength(4);
  });

  it("lets the card listed earlier through a skip, and counts the skip as no evidence", () => {
    const spec = game("hill", 3, 4);
    const [a, b] = nextPair(spec, [])!;
    const skipped: Outcome[] = [[a, b, null]];
    expect(nextPair(spec, skipped)![0]).toBe(Math.min(a, b));
    expect(duels(skipped)).toEqual([]);
  });
});

describe("bracket", () => {
  it("of seven takes six duels", () => {
    expect(playOut(game("bracket", 7, 1), higherWins).history).toHaveLength(6);
  });
});

describe("swiss", () => {
  it("never repeats a pair while a new one is free", () => {
    const { history } = playOut(game("swiss", 8, 8), lowerWins);
    expect(new Set(pairsOf(history)).size).toBe(history.length);
    // A card the greedy pairing cannot place without a repeat sits that round out.
    expect(history.length).toBeGreaterThanOrEqual(swissRounds(8) * 3);
    expect(history.length).toBeLessThanOrEqual(swissRounds(8) * 4);
  });

  it("runs ceil(log2 n) + 2 rounds", () => {
    expect([2, 3, 4, 5, 8, 64].map(swissRounds)).toEqual([3, 4, 4, 5, 5, 8]);
  });
});

describe("refine", () => {
  it("asks neighbours who have not met, at most half the cards", () => {
    const main = playOut(game("hill", 6, 6), lowerWins).history;
    const refined = playOut(game("hill", 6, 6, true), lowerWins).history;
    const extra = refined.slice(main.length);
    expect(extra.length).toBeGreaterThanOrEqual(1);
    expect(extra.length).toBeLessThanOrEqual(3);
    const metBefore = new Set(pairsOf(main));
    expect(pairsOf(extra).filter((pair) => metBefore.has(pair))).toEqual([]);
    expect(nextPair(game("hill", 6, 6, true), refined)).toBeNull();
  });

  it("meets dashed cards first", () => {
    // 0 and 1 met three times; 2 and 3 never played. Both dashed cards get a duel before any close call.
    const pairs = refinePairs(4, [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ]);
    expect(pairs.flat()).toEqual(expect.arrayContaining([2, 3]));
  });

  it("gives a dashed card the card above it when both sides are as close", () => {
    // A cycle leaves 0, 1 and 2 level with the two who never played, 3 and 4.
    const cycle: Outcome[] = [
      [0, 1, 0],
      [1, 2, 1],
      [2, 0, 2],
    ];
    expect(refinePairs(5, cycle)).toEqual([
      [2, 3],
      [1, 4],
    ]);
  });
});

describe("a game", () => {
  it("places every card in exactly one tier", () => {
    const spec = game("swiss", 9, 99, true);
    const placed = result(spec, playOut(spec, higherWins).history, 5).flat();
    expect(placed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps a bracket of sixteen to three groups, its evidence being thin", () => {
    // Fifteen duels over sixteen cards; the best fit alone would cut four groups here.
    const spec = game("bracket", 16, 1);
    const { history } = playOut(spec, lowerWins);
    expect(duelsPerCard(standing(16, duels(history)))).toBeLessThan(SOLID_DUELS);
    expect(result(spec, history, 8).filter((tier) => tier.length > 0)).toHaveLength(THIN_GROUPS);
  });

  it("is no game with one card", () => {
    expect(nextPair(game("bracket", 1, 0), [])).toBeNull();
    expect(isOver(game("bracket", 1, 0), [])).toBe(true);
    expect(progress(game("bracket", 1, 0), [])).toEqual({ asked: 0, total: 0 });
  });

  it("is over exactly when there is no next pair", () => {
    const spec = game("bracket", 4, 9);
    const { history } = playOut(spec, lowerWins);
    expect(isOver(spec, history)).toBe(true);
    expect(isOver(spec, history.slice(0, -1))).toBe(false);
  });

  it("takes as its winner only a card it showed", () => {
    expect(outcomeOf([2, 5], 5)).toEqual([2, 5, 5]);
    expect(outcomeOf([2, 5], null)).toEqual([2, 5, null]);
    expect(() => outcomeOf([2, 5], 3)).toThrow(RangeError);
  });
});

describe("duelsPlayed", () => {
  it("counts real duels per card, skips left out, as the standing does", () => {
    const history: Outcome[] = [
      [0, 1, 0],
      [1, 2, null],
      [2, 0, 2],
    ];
    expect(duelsPlayed(4, history)).toEqual([2, 1, 1, 0]);
    expect(duelsPlayed(4, history)).toEqual(standing(4, duels(history)).played);
  });
});

describe("progress", () => {
  it("knows a hill's length from the start, with refine's most added", () => {
    expect(progress(game("hill", 7, 3), [])).toEqual({ asked: 0, total: 6 });
    expect(progress(game("hill", 7, 3, true), [])).toEqual({ asked: 0, total: 10 });
  });

  const kinds: GameKind[] = ["hill", "bracket", "swiss"];
  const specs = kinds.flatMap((kind) => [game(kind, 9, 99), game(kind, 9, 99, true)]);

  it.each(specs)("never grows for $kind (refine: $refine), and ends at what was asked", (spec) => {
    const skipEveryThird = (pair: Pair) => (pair[0] % 3 === 0 ? null : lowerWins(pair));
    const { history, progressions } = playOut(spec, skipEveryThird);
    progressions.forEach(({ asked, total }, step) => {
      expect(asked).toBe(step);
      if (step < history.length) expect(total).toBeGreaterThan(asked);
      if (step > 0) expect(total).toBeLessThanOrEqual(progressions[step - 1]!.total);
    });
    expect(progressions.at(-1)).toEqual({ asked: history.length, total: history.length });
  });
});
