import { describe, expect, it } from "vitest";
import { nextPair, progress, smartLimit, type GameSpec, type Outcome, type Pair } from "./games";
import { edgePairs, SMART_MOST, tierOfCards } from "./smart";
import { standing } from "./strength";

const spec = (count: number, tiers: number, seed = 1): GameSpec => ({
  kind: "smart",
  count,
  seed,
  refine: false,
  tiers,
});

/** Plays a smart game to its end, every answer from `answer`, keeping each step's pair. */
function play(game: GameSpec, answer: (pair: Pair, asked: number) => number | null) {
  const history: Outcome[] = [];
  const pairs: Pair[] = [];
  for (let pair = nextPair(game, history); pair !== null; pair = nextPair(game, history)) {
    pairs.push(pair);
    history.push([pair[0], pair[1], answer(pair, history.length)]);
  }
  return { history, pairs };
}

const stronger = ([first, second]: Pair) => Math.max(first, second);

describe("smart pairs", () => {
  it("asks fewer duels than Losers stay would, and never more", () => {
    for (const count of [2, 3, 5, 10, 17, 40]) {
      const { history } = play(spec(count, 5), stronger);
      expect(history.length).toBeLessThanOrEqual(smartLimit(count));
      if (count >= 10) expect(history.length).toBeLessThan(smartLimit(count));
    }
  });

  it("asks a pair it has asked before never again, a skipped one included", () => {
    const { pairs } = play(spec(20, 6), (pair, asked) => (asked % 4 === 0 ? null : stronger(pair)));
    const seen = pairs.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("ends after the opening when every answer is a skip: no evidence, no edges", () => {
    const { history } = play(spec(12, 5), () => null);
    expect(history.length).toBe(12);
  });

  it("goes on from any part of its answers the same, in whatever order it is asked", () => {
    const game = spec(30, 5, 9);
    const { history, pairs } = play(game, (pair, asked) =>
      asked % 7 === 3 ? Math.min(...pair) : stronger(pair),
    );
    const order = [17, 3, 60, 0, 44, 45, 12, history.length, 29, 70, 1];
    for (const length of order.filter((n) => n <= history.length)) {
      expect(nextPair(game, history.slice(0, length))).toEqual(pairs[length] ?? null);
    }
  });

  it("estimates a total that only shrinks and ends at what was asked", () => {
    const game = spec(16, 4);
    const { history } = play(game, stronger);
    let before = Infinity;
    for (let asked = 0; asked <= history.length; asked++) {
      const { total } = progress(game, history.slice(0, asked));
      expect(total).toBeGreaterThanOrEqual(asked);
      expect(total).toBeLessThanOrEqual(Math.max(before, smartLimit(16)));
      before = total;
    }
    expect(progress(game, history).total).toBe(history.length);
  });
});

describe("a batch at the tiers' edges", () => {
  // Six cards that each beat the next once: a ladder, cut into three tiers.
  const ladder = standing(
    6,
    [0, 1, 2, 3, 4].map((card) => ({ winner: card, loser: card + 1 })),
  );
  const never = () => false;

  it("pairs only cards of tiers next to each other, each card once, the better placed first", () => {
    const placed = tierOfCards(ladder, 3);
    const pairs = edgePairs(ladder, 3, never);
    expect(pairs.length).toBeGreaterThan(0);
    const cards = pairs.flat();
    expect(new Set(cards).size).toBe(cards.length);
    const place = (card: number) => ladder.order.indexOf(card);
    for (const [first, second] of pairs) {
      expect(Math.abs(placed[first]! - placed[second]!)).toBe(1);
      expect(place(first)).toBeLessThan(place(second));
    }
  });

  it("never pairs cards that met, and has nothing to ask in one tier", () => {
    expect(edgePairs(ladder, 3, () => true)).toEqual([]);
    expect(edgePairs(ladder, 1, never)).toEqual([]);
  });

  it("leaves a card alone once it has played SMART_MOST duels, wherever it stands", () => {
    const duels = [];
    for (let round = 0; round < SMART_MOST; round++) {
      duels.push({ winner: 0, loser: 1 }, { winner: 1, loser: 0 });
    }
    const even = standing(3, [...duels, { winner: 0, loser: 2 }, { winner: 1, loser: 2 }]);
    for (const [first, second] of edgePairs(even, 2, never)) {
      expect([first, second]).toContain(2);
    }
  });
});
