import { describe, expect, it } from "vitest";
import { memoryStore } from "../../lib/storage";
import { newGame, startRefine, type Game } from "./game";
import {
  decodeGame,
  encodeGame,
  EXPIRES_AFTER,
  LAST_GAME_KEY,
  lastGame,
  localGames,
  playKey,
  rememberGame,
} from "./savedGames";

const game = (): Game => ({
  ...newGame(
    "hill",
    ["a", "b", "c"],
    { kind: "rows", tiers: ["s"], pool: true, keepTier: false },
    -7,
    100,
  ),
  history: [
    [0, 1, 1],
    [1, 2, null],
  ],
});

describe("a saved game's text", () => {
  it("comes back as the game it was", () => {
    const refining = startRefine(game());
    expect(decodeGame(encodeGame(game(), 5))).toEqual({ game: game(), savedAt: 5 });
    expect(decodeGame(encodeGame(refining, 5))?.game).toEqual(refining);
  });

  it("is refused when it is not a game", () => {
    const bad = (change: (value: Record<string, unknown>) => void) => {
      const value = JSON.parse(encodeGame(game(), 5)) as Record<string, unknown>;
      change(value);
      return decodeGame(JSON.stringify(value));
    };
    expect(decodeGame("not json")).toBeNull();
    expect(decodeGame("null")).toBeNull();
    expect(bad((v) => (v.version = 2))).toBeNull();
    expect(bad((v) => ((v.game as Game).spec.kind = "chess" as never))).toBeNull();
    expect(bad((v) => ((v.game as Game).ids = ["a"]))).toBeNull();
    expect(bad((v) => ((v.game as Game).history = [[0, 9, 0]]))).toBeNull();
    expect(bad((v) => ((v.game as Game).history = [[0, 1, 2]]))).toBeNull();
    expect(bad((v) => ((v.game as Game).history = [[0, 0, null]]))).toBeNull();
    expect(bad((v) => ((v.game as Game).chosen = { kind: "some" } as never))).toBeNull();
    expect(bad((v) => ((v.game as Game).refineFixed = { from: 9, pairs: [] }))).toBeNull();
    expect(bad((v) => ((v.game as Game).refineFixed = { from: 1, pairs: [[0, 5]] }))).toBeNull();
    expect(bad((v) => ((v.game as Game).spec.count = 65))).toBeNull();
  });
});

describe("this device's saved games", () => {
  it("keeps one game a board, at play:{board}", () => {
    const store = memoryStore();
    const games = localGames(store, () => 1_000);
    expect(games.load("b1")).toBeNull();
    games.save("b1", game());
    expect(store.read(playKey("b1"))).not.toBeNull();
    expect(games.load("b1")).toEqual(game());
    expect(games.load("b2")).toBeNull();
    games.discard("b1");
    expect(games.load("b1")).toBeNull();
  });

  it("forgets a game left alone for 30 days, silently", () => {
    const store = memoryStore();
    let now = 1_000;
    const games = localGames(store, () => now);
    games.save("b1", game());
    now += EXPIRES_AFTER;
    expect(games.load("b1")).toEqual(game());
    now += 1;
    expect(games.load("b1")).toBeNull();
    expect(store.read(playKey("b1"))).toBeNull();
  });

  it("drops what it cannot read", () => {
    const store = memoryStore();
    store.write(playKey("b1"), "{");
    expect(localGames(store).load("b1")).toBeNull();
    expect(store.read(playKey("b1"))).toBeNull();
  });
});

describe("the last game started", () => {
  it("is losers stay until one is started, then that one", () => {
    const store = memoryStore();
    expect(lastGame(store)).toBe("swiss");
    rememberGame(store, "bracket");
    expect(lastGame(store)).toBe("bracket");
    store.write(LAST_GAME_KEY, "chess");
    expect(lastGame(store)).toBe("swiss");
  });
});
