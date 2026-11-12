import { describe, expect, it } from "vitest";
import { boardOf, type PlayCard, type PlayTier } from "./board";
import { decodeGame, encodeGame } from "./savedGames";
import { fromSynced, toSynced } from "./syncedGames";
import { playOf } from "../boards/repository";
import { areaName, areaOf, EVERYTHING, type Chosen } from "./chosen";
import { refinePairs, swissRound, swissRounds, type GameKind } from "./engine";
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
  unplayedMatters,
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
    expect(reconcile(game, board)).toEqual({ kind: "ready", game });
  });

  it("asks the hill and the bracket to start over", () => {
    const game = pick(start("bracket", ["a", "b", "c"]), 0);
    const fewer = boardOf(cardsNamed("a", "b"), [tier("s")]);
    const more = boardOf(cardsNamed("a", "b", "c", "d"), [tier("s")]);
    expect(reconcile(game, fewer).kind).toBe("changed");
    expect(reconcile(game, more)).toEqual({ kind: "ready", game });
  });

  it("keeps the saved participants and the fixed close calls when new cards appear", () => {
    const refining = startRefine(playOut(start("swiss", ["p1", "p2", "p3"]), lowerWins));
    const board = boardOf(cardsNamed("p1", "p2", "p3", "extra"), [tier("s")]);
    expect(reconcile(refining, board)).toEqual({ kind: "ready", game: refining });
    expect(reconcile(refining, boardOf(cardsNamed("p1", "p2", "extra"), [tier("s")])).kind).toBe(
      "changed",
    );
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
    expect(applied(board, [["q"], ["p"]], { ids: ["p", "q"], chosen: EVERYTHING })).toEqual([
      ["q", "x"],
      ["p", "y", "z"],
    ]);
  });

  it("keeps a reordered tier's block before the other cards", () => {
    const board = boardOf(cardsNamed("a", "b", "c", "d"), [tier("s", ["a", "b", "c", "d"])]);
    expect(applied(board, [["d", "b"]], { ids: ["b", "d"], chosen: EVERYTHING })).toEqual([
      ["d", "b", "a", "c"],
    ]);
  });

  it("re-tiers every card of a whole-board game", () => {
    const board = boardOf(cardsNamed("a", "b", "c"), [tier("s", ["a"]), tier("a", ["b"])]);
    expect(
      applied(board, [["c"], ["b", "a"]], { ids: ["a", "b", "c"], chosen: EVERYTHING }),
    ).toEqual([["c"], ["b", "a"]]);
  });
});

describe("game areas (game-scopes WIRE-SPEC)", () => {
  // S s1 s2 s3, A a1 a2, B empty; the pool p1 p2 p3.
  const areaBoard = boardOf(cardsNamed("s1", "s2", "s3", "a1", "a2", "p1", "p2", "p3"), [
    tier("s", ["s1", "s2", "s3"]),
    tier("a", ["a1", "a2"]),
    tier("b"),
  ]);
  const ranked: Chosen = { kind: "rows", tiers: ["s", "a"], pool: false, keepTier: false };
  const pool: Chosen = { kind: "rows", tiers: [], pool: true, keepTier: false };
  const oneTier: Chosen = { kind: "rows", tiers: ["s"], pool: false, keepTier: true };
  const finish = (ids: string[], chosen: Chosen) => playOut(start("swiss", ids, chosen), lowerWins);
  const pooled = (rows: string[][]) => areaBoard.order.filter((id) => !rows.flat().includes(id));

  it("orders only its tier in one tier: the played first, the rest behind as they were", () => {
    const game = finish(["s3", "s1"], { kind: "sample", source: oneTier, ids: ["s3", "s1"] });
    const rows = resultOf(game, areaBoard);
    expect(rows).toEqual([["s3", "s1"], [], []]);
    expect(unplayedMatters(game, areaBoard)).toBe(false);
    // "To the pool" changes nothing here: s2 follows the played cards.
    const after = applied(areaBoard, rows, game, "pool");
    expect(after).toEqual([["s3", "s1", "s2"], ["a1", "a2"], []]);
    expect(pooled(after)).toEqual(["p1", "p2", "p3"]);
  });

  it("plays only the pool, and leaves every ranked card in its tier and order", () => {
    const game = finish(["p1", "p2", "p3"], pool);
    const rows = resultOf(game, areaBoard);
    expect(rows.flat().sort()).toEqual(["p1", "p2", "p3"]);
    expect(unplayedMatters(game, areaBoard)).toBe(false);
    const after = applied(areaBoard, rows, game, "pool");
    const ranked = (row: string[]) => row.filter((id) => !id.startsWith("p"));
    expect(after.map(ranked)).toEqual([["s1", "s2", "s3"], ["a1", "a2"], []]);
    // The played cards lead their tiers.
    after.forEach((row, i) => expect(row.slice(0, rows[i]!.length)).toEqual(rows[i]));
    expect(pooled(after)).toEqual([]);
  });

  it("leaves the pool alone in a ranked game, even sending the unplayed to it", () => {
    const game = finish(["s1", "a1"], { kind: "sample", source: ranked, ids: ["s1", "a1"] });
    expect(unplayedMatters(game, areaBoard)).toBe(true);
    const rows = resultOf(game, areaBoard);
    const after = applied(areaBoard, rows, game, "pool");
    expect(after.flat().sort()).toEqual(["a1", "s1"]);
    expect(pooled(after)).toEqual(["s2", "s3", "a2", "p1", "p2", "p3"]);
    expect(applied(areaBoard, rows, game, "keep").flat().sort()).toEqual([
      "a1",
      "a2",
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("sends to the pool only the unplayed cards of the tiers it was drawn from", () => {
    const rows: Chosen = { kind: "rows", tiers: ["a"], pool: true, keepTier: false };
    const game = finish(["a1", "p1"], { kind: "sample", source: rows, ids: ["a1", "p1"] });
    const after = applied(areaBoard, resultOf(game, areaBoard), game, "pool");
    expect(after.flat()).not.toContain("a2");
    expect(after.flat()).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
    expect(after[0]!.filter((id) => id.startsWith("s"))).toEqual(["s1", "s2", "s3"]);
  });

  it("does not go on, nor fall back to the whole board, when its tier is gone", () => {
    const game = finish(["s1", "s2", "s3"], oneTier);
    // S deleted: its cards went to the pool, and a new S under another id holds none of them.
    const without = boardOf(cardsNamed("s1", "s2", "s3", "a1", "a2", "p1", "p2", "p3"), [
      tier("s-new"),
      tier("a", ["a1", "a2"]),
    ]);
    expect(reconcile(game, without).kind).toBe("changed");
    expect(resultOf(game, without)).toEqual([[], []]);
  });

  it("goes on in a renamed tier: the id is the same", () => {
    const game = finish(["s1", "s2", "s3"], oneTier);
    const renamed = boardOf(cardsNamed("s1", "s2", "s3", "a1", "a2", "p1", "p2", "p3"), [
      { ...tier("s", ["s1", "s2", "s3"]), label: "X", caption: "Renamed" },
      tier("a", ["a1", "a2"]),
      tier("b"),
    ]);
    expect(reconcile(game, renamed).kind).toBe("ready");
    expect(resultOf(game, renamed)[0]).toEqual(["s1", "s2", "s3"]);
  });

  it("moves the same cards when a tier filled since makes Ranked a choice of rows", () => {
    const game = finish(["s1", "a1"], { kind: "sample", source: ranked, ids: ["s1", "a1"] });
    // A new tier N took p1 from the pool after the game began.
    const later = boardOf(cardsNamed("s1", "s2", "s3", "a1", "a2", "p1", "p2", "p3"), [
      tier("s", ["s1", "s2", "s3"]),
      tier("a", ["a1", "a2"]),
      tier("b"),
      tier("n", ["p1"]),
    ]);
    expect(areaName(areaBoard, game.chosen)).toEqual({ kind: "ranked" });
    expect(areaName(later, game.chosen)).toEqual({ kind: "board" });
    expect(reconcile(game, later).kind).toBe("ready");
    expect(areaOf(later, game.chosen)).toEqual(areaOf(areaBoard, game.chosen));
    const after = applied(later, resultOf(game, later), game, "pool");
    // N was not in the game: its card stays, while the unplayed of S and A go to the pool.
    expect(after[3]!.filter((id) => id === "p1")).toEqual(["p1"]);
    expect(after.flat()).not.toContain("s2");
    expect(after.flat()).not.toContain("a2");
  });

  it("goes on after an empty tier is deleted: Ranked names only tiers with cards", () => {
    const game = finish(["s1", "a1"], ranked);
    const without = boardOf(cardsNamed("s1", "s2", "s3", "a1", "a2", "p1", "p2", "p3"), [
      tier("s", ["s1", "s2", "s3"]),
      tier("a", ["a1", "a2"]),
    ]);
    expect(reconcile(game, without).kind).toBe("ready");
    expect(areaName(without, game.chosen)).toEqual({ kind: "ranked" });
  });

  it("travels as the scope the app writes and comes back as the same area", () => {
    const cases: [Chosen, string[], Record<string, unknown>][] = [
      [EVERYTHING, ["s1", "a1"], {}],
      [pool, ["p1", "p2"], { scope: ["pool"] }],
      [ranked, ["s1", "a1"], { scope: ["s", "a"] }],
      [oneTier, ["s1", "s2"], { scope: ["s"], keepTier: true }],
    ];
    for (const [chosen, ids, wire] of cases) {
      const game = pick(start("hill", ids, chosen), 0);
      const synced = toSynced(game, "pool", 20_000);
      expect({ scope: synced.scope, keepTier: synced.keepTier }).toEqual({
        scope: undefined,
        keepTier: undefined,
        ...wire,
      });
      const back = fromSynced(playOf(JSON.parse(JSON.stringify(synced)))!, "pool");
      expect(areaName(areaBoard, back.chosen)).toEqual(areaName(areaBoard, chosen));
      expect(areaOf(areaBoard, back.chosen)).toEqual(areaOf(areaBoard, chosen));
    }
  });
});

describe("full-board games", () => {
  for (const count of [65, 91, 128, 257]) {
    it.each(["hill", "bracket", "swiss"] as const)(
      "finishes %s with every participant at " + count,
      (kind) => {
        const board = poolBoard(count);
        const game = start(kind, [...board.order]);
        const first = pick(game, currentPair(game)![0]);
        const saved = toSynced(first, "pool", 20_000);
        const remote = fromSynced(playOf(JSON.parse(JSON.stringify(saved)))!, "pool");
        expect(currentPair(remote)).toEqual(currentPair(first));
        expect(remote.ids).toEqual(board.order);
        expect(decodeGame(encodeGame(first, 20_000))?.game).toEqual(first);
        const over = playOut(remote, lowerWins);
        expect(over.history.length).toBeGreaterThanOrEqual(count - 1);
        const rows = resultOf(over, board).flat();
        expect(rows).toHaveLength(count);
        expect(new Set(rows)).toEqual(new Set(board.order));
      },
    );
  }

  it("recovers the last Swiss round and the fixed refinement on a 2,000-card board", () => {
    const board = poolBoard(2000);
    const game = start("swiss", [...board.order]);
    for (let round = 0; round < swissRounds(2000); round++) {
      for (const [a, b] of swissRound(2000, game.history)) game.history.push([a, b, a]);
    }
    expect(game.history.length).toBeGreaterThan(12_000);
    const from = game.history.length;
    const refining = startRefine(game);
    expect(refining.refineFixed?.from).toBe(from);
    const decoded = fromSynced(playOf(toSynced(refining, "pool", 20_000))!, "pool");
    expect(currentPair(decoded)).toEqual(currentPair(refining));
    expect(decoded.history).toEqual(game.history);
    expect(resultOf(game, board).flat()).toHaveLength(2000);
  });
});
