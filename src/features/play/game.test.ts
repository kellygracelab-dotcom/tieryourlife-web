import { describe, expect, it } from "vitest";
import { boardOf, type PlayCard, type PlayTier } from "./board";
import { EVERYTHING, type Chosen } from "./chosen";
import { refinePairs, swissRounds, type GameKind } from "./engine";
import {
  answered,
  applied,
  bracketRound,
  canUndo,
  currentPair,
  dashedIds,
  estimate,
  gameProgress,
  hillStreak,
  isOver,
  isThinResult,
  newGame,
  pick,
  reconcile,
  refineCount,
  resultOf,
  seedOf,
  skip,
  startRefine,
  undo,
  type Game,
} from "./game";

const cardsNamed = (...ids: string[]): PlayCard[] =>
  ids.map((id) => ({ id, name: id.toUpperCase(), imageUrl: null }));

const tier = (id: string, cardIds: string[] = []): PlayTier => ({
  id,
  label: id.toUpperCase(),
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds,
});

/** A board of `n` cards c0…, all in the pool, under tiers S A B C D. */
function poolBoard(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  return boardOf(
    cardsNamed(...ids),
    ["s", "a", "b", "c", "d"].map((id) => tier(id)),
  );
}

const start = (kind: GameKind, ids: string[], chosen: Chosen = EVERYTHING): Game =>
  newGame(kind, ids, chosen, 12345, 1_000);

/** Answers every duel the way `winner` says, to the end. */
function playOut(game: Game, winner: (pair: readonly [number, number]) => number): Game {
  let next = game;
  for (let guard = 0; guard < 10_000; guard++) {
    const pair = currentPair(next);
    if (pair === null) return next;
    next = pick(next, winner(pair));
  }
  throw new Error("The game never ended");
}

/** The card with the lower index always wins: a clear order to find. */
const lowerWins = ([a, b]: readonly [number, number]) => Math.min(a, b);

describe("a game", () => {
  it("starts with nothing answered, over the cards it was given", () => {
    const game = start("hill", ["a", "b", "c"]);
    expect(game.spec).toEqual({ kind: "hill", count: 3, seed: 12345, refine: false });
    expect(game.ids).toEqual(["a", "b", "c"]);
    expect(game.history).toEqual([]);
    expect(game.startedAt).toBe(1_000);
    expect(canUndo(game)).toBe(false);
    expect(isOver(game)).toBe(false);
  });

  it("records a pick as the pair asked and its winner", () => {
    const game = start("hill", ["a", "b", "c"]);
    const pair = currentPair(game)!;
    const next = pick(game, pair[1]);
    expect(next.history).toEqual([[pair[0], pair[1], pair[1]]]);
    // The game itself is left as it was.
    expect(game.history).toEqual([]);
  });

  it("refuses a winner who is not in the pair", () => {
    const game = start("bracket", ["a", "b", "c", "d"]);
    const [first, second] = currentPair(game)!;
    const stranger = [0, 1, 2, 3].find((card) => card !== first && card !== second)!;
    expect(() => pick(game, stranger)).toThrow(RangeError);
  });

  it("records a skip with no winner, and moves on", () => {
    const game = start("swiss", ["a", "b", "c", "d"]);
    const pair = currentPair(game)!;
    const next = skip(game);
    expect(next.history).toEqual([[pair[0], pair[1], null]]);
    expect(currentPair(next)).not.toEqual(pair);
    expect(answered(next)).toBe(0);
  });

  it("takes the last answer back, and nothing when there is none", () => {
    const game = start("hill", ["a", "b", "c"]);
    const once = pick(game, currentPair(game)![0]);
    expect(undo(once)).toEqual(game);
    expect(undo(game)).toBe(game);
  });

  it("is over after n − 1 duels for the hill and the bracket", () => {
    for (const kind of ["hill", "bracket"] as const) {
      const over = playOut(start(kind, ["a", "b", "c", "d", "e"]), lowerWins);
      expect(over.history).toHaveLength(4);
      expect(isOver(over)).toBe(true);
      expect(currentPair(over)).toBeNull();
      // Nothing more is recorded once it is over.
      expect(pick(over, 0)).toBe(over);
      expect(skip(over)).toBe(over);
    }
  });
});

describe("its progress", () => {
  it("counts duels of the hill and the bracket from the start", () => {
    const game = start("hill", ["a", "b", "c", "d"]);
    expect(gameProgress(game)).toEqual({
      phase: "main",
      asked: 0,
      total: 3,
      round: null,
      overall: { asked: 0, total: 3 },
    });
    expect(gameProgress(pick(game, currentPair(game)![0])).asked).toBe(1);
  });

  it("tells losers stay's round, and drops it once the game is over", () => {
    const game = start("swiss", ["a", "b", "c", "d"]);
    expect(gameProgress(game).round).toEqual({ n: 1, of: swissRounds(4) });
    // Four cards: two duels a round.
    const second = pick(
      pick(game, currentPair(game)![0]),
      currentPair(pick(game, currentPair(game)![0]))![0],
    );
    expect(gameProgress(second).round).toEqual({ n: 2, of: 4 });
    const over = playOut(game, lowerWins);
    expect(gameProgress(over).round).toBeNull();
    expect(gameProgress(over).asked).toBe(gameProgress(over).total);
  });

  it("counts the close calls on their own once refining", () => {
    const over = playOut(start("swiss", ["a", "b", "c", "d", "e", "f"]), lowerWins);
    const refining = startRefine(over);
    const pairs = refinePairs(6, over.history);
    expect(pairs.length).toBeGreaterThan(0);
    expect(gameProgress(refining)).toEqual({
      phase: "refine",
      asked: 0,
      total: pairs.length,
      round: null,
      overall: { asked: over.history.length, total: over.history.length + pairs.length },
    });
  });

  it("tells a bracket's round by the cards still in it, byes counted", () => {
    // Five cards: two duels and a bye leave three, one duel and a bye leave two.
    let game = start("bracket", ["a", "b", "c", "d", "e"]);
    const rounds: (number | null)[] = [];
    while (currentPair(game) !== null) {
      rounds.push(bracketRound(game));
      game = skip(game);
    }
    expect(rounds).toEqual([5, 5, 3, 2]);
    expect(bracketRound(game)).toBeNull();
    expect(bracketRound(start("hill", ["a", "b", "c"]))).toBeNull();
  });

  it("counts the hill's run of wins, a skip breaking it", () => {
    let game = start("hill", ["a", "b", "c", "d", "e"]);
    expect(hillStreak(game)).toEqual({ champion: currentPair(game)![0], wins: 0 });
    game = pick(game, currentPair(game)![0]);
    game = pick(game, currentPair(game)![0]);
    expect(hillStreak(game)).toEqual({ champion: currentPair(game)![0], wins: 2 });
    game = skip(game);
    expect(hillStreak(game)!.wins).toBe(0);
    expect(hillStreak(start("swiss", ["a", "b", "c"]))).toBeNull();
    expect(hillStreak(playOut(start("hill", ["a", "b", "c"]), lowerWins))).toBeNull();
  });
});

describe("refine", () => {
  const over = playOut(start("hill", ["a", "b", "c", "d", "e", "f"]), lowerWins);

  it("is offered only once the game is over, and asks the engine's close calls in order", () => {
    expect(refineCount(start("hill", ["a", "b", "c"]))).toBe(0);
    const pairs = refinePairs(6, over.history);
    expect(refineCount(over)).toBe(pairs.length);
    const refining = startRefine(over);
    expect(refining.spec.refine).toBe(true);
    expect(refining.refineFixed).toEqual({ from: over.history.length, pairs });
    expect(currentPair(refining)).toEqual(pairs[0]);
    expect(isOver(refining)).toBe(false);
  });

  it("is used up once started: no second Refine", () => {
    const done = playOut(startRefine(over), lowerWins);
    expect(isOver(done)).toBe(true);
    expect(refineCount(done)).toBe(0);
    expect(startRefine(done)).toBe(done);
  });

  it("goes when its first close call is taken back past", () => {
    const refining = startRefine(over);
    const first = pick(refining, currentPair(refining)![0]);
    // Back to the first close call: still refining.
    expect(undo(first)).toEqual(refining);
    // Back past it: the main game's last duel again, and Refine not used.
    const back = undo(refining);
    expect(back.refineFixed).toBeUndefined();
    expect(back.spec.refine).toBe(false);
    expect(back.history).toEqual(over.history.slice(0, -1));
    expect(isOver(back)).toBe(false);
  });
});

describe("the result", () => {
  it("is tiers of card ids, the clear winner on top", () => {
    const board = poolBoard(4);
    const over = playOut(start("swiss", ["c0", "c1", "c2", "c3"]), lowerWins);
    const rows = resultOf(over, board);
    expect(rows).toHaveLength(5);
    expect(rows[0]![0]).toBe("c0");
    expect(rows.flat().sort()).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("keeps the cards of one tier in it, only in order, when asked to", () => {
    const board = boardOf(cardsNamed("x", "y", "z"), [tier("s"), tier("a", ["x", "y", "z"])]);
    const chosen: Chosen = { kind: "rows", tiers: ["a"], pool: false, keepTier: true };
    const over = playOut(start("hill", ["x", "y", "z"], chosen), ([a, b]) => Math.max(a, b));
    expect(resultOf(over, board)).toEqual([[], ["z", "y", "x"]]);
  });

  it("marks the cards that played fewer than two duels, and calls the result thin when they are many", () => {
    // A hill of four where the first champion wins everything: the others play once.
    const over = playOut(start("hill", ["a", "b", "c", "d"]), ([champion]) => champion);
    const dashed = dashedIds(over);
    expect(dashed.size).toBe(3);
    expect(isThinResult(over)).toBe(true);

    const solid = playOut(start("swiss", ["a", "b", "c", "d"]), lowerWins);
    expect(dashedIds(solid).size).toBe(0);
    expect(isThinResult(solid)).toBe(false);
  });
});

describe("the estimate", () => {
  it("says the design's numbers for 34 cards", () => {
    expect(estimate("swiss", 34)).toEqual({ duels: 136, minutes: 5, rough: true });
    expect(estimate("hill", 34)).toEqual({ duels: 33, minutes: 1, rough: false });
    expect(estimate("bracket", 34)).toEqual({ duels: 33, minutes: 1, rough: false });
  });

  it("never says less than a minute", () => {
    expect(estimate("hill", 3).minutes).toBe(1);
  });
});

describe("a seed", () => {
  it("is a signed 32-bit integer", () => {
    expect(seedOf(() => 0)).toBe(0);
    expect(seedOf(() => 0.25)).toBe(0x4000_0000);
    expect(seedOf(() => 0.75)).toBe(-0x4000_0000);
    expect(Number.isInteger(seedOf(Math.random))).toBe(true);
  });
});

describe("resuming on a board that changed", () => {
  it("resumes as it was when nothing changed, wherever the cards moved", () => {
    const board = boardOf(cardsNamed("a", "b", "c"), [tier("s", ["c"]), tier("a")]);
    const game = pick(start("hill", ["a", "b", "c"]), 0);
    expect(reconcile(game, board)).toEqual({ kind: "ready", game, joined: 0 });
  });

  it("asks the hill and the bracket to start over", () => {
    const game = pick(start("bracket", ["a", "b", "c"]), 0);
    const fewer = boardOf(cardsNamed("a", "b"), [tier("s")]);
    const more = boardOf(cardsNamed("a", "b", "c", "d"), [tier("s")]);
    expect(reconcile(game, fewer).kind).toBe("changed");
    expect(reconcile(game, more).kind).toBe("changed");
  });

  it("drops a deleted card's answers from losers stay, renumbers the rest and adds new cards at the end", () => {
    const game: Game = {
      ...start("swiss", ["a", "b", "c", "d"]),
      history: [
        [0, 1, 0],
        [2, 3, 3],
        [0, 3, null],
        [1, 2, 2],
      ],
    };
    // b is gone; e and f are new.
    const board = boardOf(cardsNamed("a", "c", "d", "e", "f"), [tier("s")]);
    const resumed = reconcile(game, board);
    expect(resumed.kind).toBe("ready");
    if (resumed.kind !== "ready") return;
    expect(resumed.joined).toBe(2);
    expect(resumed.game.ids).toEqual(["a", "c", "d", "e", "f"]);
    expect(resumed.game.spec.count).toBe(5);
    // c and d were 2 and 3; now 1 and 2.
    expect(resumed.game.history).toEqual([
      [1, 2, 2],
      [0, 2, null],
    ]);
  });

  it("lets only the chosen rows' new cards join, and starts the close calls afresh", () => {
    const over = playOut(
      start("swiss", ["p1", "p2", "p3"], { kind: "rows", tiers: [], pool: true, keepTier: false }),
      lowerWins,
    );
    const refining = startRefine(over);
    const board = boardOf(cardsNamed("p1", "p2", "p3", "p4", "s1"), [tier("s", ["s1"])]);
    const resumed = reconcile(refining, board);
    if (resumed.kind !== "ready") throw new Error("not resumed");
    expect(resumed.game.ids).toEqual(["p1", "p2", "p3", "p4"]);
    expect(resumed.game.refineFixed).toBeUndefined();
    expect(resumed.game.spec.refine).toBe(false);
  });

  it("starts over when too few cards are left", () => {
    const game = start("swiss", ["a", "b", "c"]);
    expect(reconcile(game, boardOf(cardsNamed("a"), [tier("s")])).kind).toBe("changed");
  });
});

describe("applying a result", () => {
  it("puts the played cards where the result says and leaves the rest", () => {
    // S holds x; A holds y and z; the pool p and q were played.
    const board = boardOf(cardsNamed("x", "y", "z", "p", "q"), [
      tier("s", ["x"]),
      tier("a", ["y", "z"]),
    ]);
    expect(applied(board, [["q"], ["p"]], ["p", "q"])).toEqual([
      ["x", "q"],
      ["y", "z", "p"],
    ]);
  });

  it("keeps a reordered tier's block where its first played card stood", () => {
    const board = boardOf(cardsNamed("a", "b", "c", "d"), [tier("s", ["a", "b", "c", "d"])]);
    expect(applied(board, [["d", "b"]], ["b", "d"])).toEqual([["a", "d", "b", "c"]]);
  });

  it("re-tiers every card of a whole-board game", () => {
    const board = boardOf(cardsNamed("a", "b", "c"), [tier("s", ["a"]), tier("a", ["b"])]);
    expect(applied(board, [["c"], ["b", "a"]], ["a", "b", "c"])).toEqual([["c"], ["b", "a"]]);
  });
});
