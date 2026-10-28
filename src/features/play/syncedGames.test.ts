import { describe, expect, it } from "vitest";
import type { SyncedPlay } from "../../api/boards";
import { canonicalPlay } from "../boards/fingerprint";
import { playOf } from "../boards/repository";
import { nextPair, type Outcome } from "./engine";
import { newGame, startRefine, type Game } from "./game";
import { boardGames, fromSynced, toSynced } from "./syncedGames";

/** Answers a game to its end, the left card winning every duel. */
function played(game: Game): Game {
  const history: Outcome[] = [...game.history];
  for (
    let pair = nextPair(game.spec, history);
    pair !== null;
    pair = nextPair(game.spec, history)
  ) {
    history.push([pair[0], pair[1], pair[0]]);
  }
  return { ...game, history };
}

const example: SyncedPlay = playOf({
  kind: "swiss",
  count: 4,
  seed: 7,
  refine: false,
  ids: ["a", "b", "c", "d"],
  history: [
    [0, 1, 0],
    [2, 3, null],
  ],
  round: 1,
  startedAt: 1793146000000,
  scope: ["t-s"],
  keepTier: true,
})!;

describe("a game kept in the board", () => {
  it("reads the app's shared example and writes it back byte for byte", () => {
    const game = fromSynced(example, "pool");
    expect(game.chosen).toEqual({ kind: "rows", tiers: ["t-s"], pool: false, keepTier: true });
    expect(game.history).toEqual(example.history);
    expect(canonicalPlay(toSynced(game, "pool", 1793146000001))).toBe(canonicalPlay(example));
  });

  it("names the pool by its uid in the scope, and the whole board by no scope", () => {
    const rows = newGame(
      "hill",
      ["x", "y", "z"],
      { kind: "rows", tiers: ["t1"], pool: true, keepTier: false },
      3,
      10,
    );
    expect(toSynced(rows, "pool", 20)).toMatchObject({ scope: ["t1", "pool"] });
    expect(toSynced(rows, "pool", 20).keepTier).toBeUndefined();
    const all = newGame("bracket", ["x", "y", "z"], { kind: "all" }, 3, 10);
    expect(toSynced(all, "pool", 20).scope).toBeUndefined();
    expect(fromSynced(toSynced(rows, "pool", 20), "pool").chosen).toEqual(rows.chosen);
  });

  it("never dates a game in the future", () => {
    const game = newGame("hill", ["x", "y", "z"], { kind: "all" }, 3, 500);
    expect(toSynced(game, null, 100).startedAt).toBe(100);
  });

  it("finds where Refine began again from the answers alone", () => {
    const main = played(newGame("hill", ["a", "b", "c", "d", "e"], { kind: "all" }, 11, 1));
    const refining = startRefine(main);
    const back = fromSynced(toSynced(refining, null, 2), null);
    expect(back.refineFixed).toEqual(refining.refineFixed);
    expect(back.spec.refine).toBe(true);
  });

  it("counts the Swiss rounds answered whole, and 0 for the other games", () => {
    const swiss = newGame("swiss", ["a", "b", "c", "d"], { kind: "all" }, 7, 1);
    expect(toSynced(swiss, null, 2).round).toBe(0);
    expect(
      toSynced(
        {
          ...swiss,
          history: [
            [0, 1, 0],
            [2, 3, 2],
          ],
        },
        null,
        2,
      ).round,
    ).toBe(1);
    expect(toSynced(newGame("hill", ["a", "b", "c"], { kind: "all" }, 1, 1), null, 2).round).toBe(
      0,
    );
  });

  it("loads, saves and discards through the board", () => {
    let kept: SyncedPlay | null = null;
    const games = boardGames(
      () => kept,
      (play) => {
        kept = play;
      },
      "pool",
      () => 50,
    );
    expect(games.load("b")).toBeNull();
    const game = newGame("hill", ["x", "y", "z"], { kind: "all" }, 3, 10);
    games.save("b", game);
    expect(kept).toMatchObject({ kind: "hill", ids: ["x", "y", "z"], startedAt: 10 });
    expect(games.load("b")?.ids).toEqual(["x", "y", "z"]);
    games.discard("b");
    expect(kept).toBeNull();
  });
});
