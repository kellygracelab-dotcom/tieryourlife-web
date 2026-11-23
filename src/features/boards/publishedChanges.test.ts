import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { addToPool, liveItems, moveItem, newBoard, rankedTiers, type Board } from "./model";
import { changesAgainst } from "./publishedChanges";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

/** Dune and Heat in S, Alien in the pool. */
const board = (): Board => {
  const next = uids();
  let b = addToPool(
    newBoard("b", "Films", 1, next),
    ["Dune", "Heat", "Alien"].map((title) => ({ title, imageUrl: null })),
    1,
    next,
  );
  const s = rankedTiers(b)[0]!.uid;
  for (const item of liveItems(b).slice(0, 2)) b = moveItem(b, item.uid, s, 99, 2);
  return b;
};

const listOf = (items: [string, number | null][]): PublishedList =>
  ({
    items: items.map(([title, tierIndex]) => ({ title, imageUrl: null, tierIndex })),
  }) as unknown as PublishedList;

describe("changesAgainst", () => {
  it("counts nothing when the list shows the board", () => {
    expect(
      changesAgainst(
        board(),
        listOf([
          ["Dune", 0],
          ["heat ", 0],
          ["Alien", null],
        ]),
      ),
    ).toBe(0);
  });

  it("counts each card added, moved or gone once", () => {
    // Alien is new here, Heat moved from B to S, Arrival is gone.
    expect(
      changesAgainst(
        board(),
        listOf([
          ["Dune", 0],
          ["Heat", 2],
          ["Arrival", 1],
        ]),
      ),
    ).toBe(3);
  });
});
