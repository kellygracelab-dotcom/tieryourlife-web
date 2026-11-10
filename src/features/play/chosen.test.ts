import { describe, expect, it } from "vitest";
import { boardOf, cardOf, type PlayTier } from "./board";
import { replaySelection, chosenIds, EVERYTHING, keptTier, playable } from "./chosen";

const tier = (id: string, cardIds: string[]): PlayTier => ({
  id,
  label: id.toUpperCase(),
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
  cardIds,
});

const cards = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, imageUrl: null }));
// S holds b and a, A holds d; c and e are in the pool. "zz" is not a card.
const board = boardOf(cards, [tier("s", ["b", "a", "zz"]), tier("a", ["d", "b"]), tier("b", [])]);

describe("the board as Play reads it", () => {
  it("orders the cards tiers first, left to right, then the pool, each card once", () => {
    expect(board.tiers.map((t) => t.cardIds)).toEqual([["b", "a"], ["d"], []]);
    expect(board.pool).toEqual(["c", "e"]);
    expect(board.order).toEqual(["b", "a", "d", "c", "e"]);
  });

  it("draws a card that left the board without a name", () => {
    expect(cardOf(board, "gone")).toEqual({ id: "gone", name: "", imageUrl: null });
  });
});

describe("the chosen cards", () => {
  it("are every card, whole rows, or cards picked one by one, in the board's order", () => {
    expect(chosenIds(board, EVERYTHING)).toEqual(["b", "a", "d", "c", "e"]);
    expect(chosenIds(board, { kind: "rows", tiers: ["a"], pool: true, keepTier: false })).toEqual([
      "d",
      "c",
      "e",
    ]);
    expect(
      chosenIds(board, { kind: "picked", tier: "s", ids: ["a", "b", "gone"], keepTier: true }),
    ).toEqual(["b", "a"]);
  });

  it("stay in their tier only when they are one tier's and that is asked", () => {
    expect(keptTier(board, { kind: "rows", tiers: ["a"], pool: false, keepTier: true })).toBe(1);
    expect(
      keptTier(board, { kind: "rows", tiers: ["a"], pool: false, keepTier: false }),
    ).toBeNull();
    expect(keptTier(board, { kind: "rows", tiers: ["a"], pool: true, keepTier: true })).toBeNull();
    expect(
      keptTier(board, { kind: "rows", tiers: ["s", "a"], pool: false, keepTier: true }),
    ).toBeNull();
    expect(keptTier(board, { kind: "picked", tier: "s", ids: [], keepTier: true })).toBe(0);
    expect(keptTier(board, { kind: "picked", tier: null, ids: [], keepTier: true })).toBeNull();
    expect(
      keptTier(board, { kind: "rows", tiers: ["gone"], pool: false, keepTier: true }),
    ).toBeNull();
    expect(keptTier(board, EVERYTHING)).toBeNull();
  });

  it("keeps the two-card minimum for a selection of any supported size", () => {
    expect(playable(1)).toBe(false);
    expect(playable(2)).toBe(true);
    expect(playable(64)).toBe(true);
    expect(playable(65)).toBe(true);
  });
});

it("replays even an originally full game over its old members until Everything is explicitly chosen", () => {
  const oldIds = ["a", "b", "c"];
  const board = boardOf(
    ["a", "b", "c", "new"].map((id) => ({ id, name: id, imageUrl: null })),
    [],
  );
  const replay = replaySelection(board, EVERYTHING, oldIds);
  expect(chosenIds(board, replay)).toEqual(oldIds);
  expect(chosenIds(board, EVERYTHING)).toEqual(["a", "b", "c", "new"]);
});
