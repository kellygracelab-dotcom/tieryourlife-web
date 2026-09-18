import { describe, expect, it } from "vitest";
import {
  canUndo,
  init,
  MAX_HISTORY,
  placedCount,
  pool,
  reduce,
  tierForKey,
  tierOf,
  type BoardAction,
  type BoardState,
} from "./model";

const run = (state: BoardState, ...actions: BoardAction[]) => actions.reduce(reduce, state);

describe("board model", () => {
  it("starts with every item in the pool and nothing to undo", () => {
    const state = init(3, 4);
    expect(state.rows).toEqual([[], [], []]);
    expect(pool(state)).toEqual([0, 1, 2, 3]);
    expect(placedCount(state)).toBe(0);
    expect(canUndo(state)).toBe(false);
  });

  it("places an item at the end of a tier and takes it out of the pool", () => {
    const state = run(
      init(2, 3),
      { type: "place", item: 2, tier: 0 },
      { type: "place", item: 0, tier: 0 },
    );
    expect(state.rows).toEqual([[2, 0], []]);
    expect(pool(state)).toEqual([1]);
    expect(placedCount(state)).toBe(2);
    expect(tierOf(state, 2)).toBe(0);
    expect(tierOf(state, 1)).toBeNull();
  });

  it("moves an item between tiers instead of duplicating it", () => {
    const state = run(
      init(2, 2),
      { type: "place", item: 0, tier: 0 },
      { type: "place", item: 0, tier: 1 },
    );
    expect(state.rows).toEqual([[], [0]]);
  });

  it("ignores placing an item where it already is, but drops the selection", () => {
    const placed = run(init(2, 2), { type: "place", item: 0, tier: 0 });
    expect(reduce(placed, { type: "place", item: 0, tier: 0 })).toBe(placed);
    const selected = reduce(placed, { type: "select", item: 0 });
    const again = reduce(selected, { type: "place", item: 0, tier: 0 });
    expect(again.selected).toBeNull();
    expect(again.history).toEqual(placed.history);
  });

  it("refuses items and tiers the board does not have", () => {
    const state = init(2, 2);
    expect(reduce(state, { type: "place", item: 5, tier: 0 })).toBe(state);
    expect(reduce(state, { type: "place", item: 0, tier: 2 })).toBe(state);
    expect(reduce(state, { type: "place", item: 0.5, tier: 0 })).toBe(state);
    expect(reduce(state, { type: "select", item: 9 })).toBe(state);
  });

  it("sends an item back to the pool and ignores unplacing a pooled one", () => {
    const state = run(
      init(2, 2),
      { type: "place", item: 1, tier: 1 },
      { type: "unplace", item: 1 },
    );
    expect(state.rows).toEqual([[], []]);
    expect(reduce(state, { type: "unplace", item: 1 })).toBe(state);
  });

  it("selects, toggles and clears the selection", () => {
    const one = reduce(init(1, 2), { type: "select", item: 1 });
    expect(one.selected).toBe(1);
    expect(reduce(one, { type: "select", item: 1 }).selected).toBeNull();
    expect(reduce(one, { type: "select", item: 0 }).selected).toBe(0);
    expect(reduce(one, { type: "select", item: null }).selected).toBeNull();
    const cleared = reduce(init(1, 1), { type: "select", item: null });
    expect(cleared).toBe(cleared);
  });

  it("undoes placements one at a time and picks the card that came back", () => {
    const state = run(
      init(2, 2),
      { type: "place", item: 0, tier: 0 },
      { type: "place", item: 1, tier: 1 },
      { type: "select", item: 0 },
    );
    const once = reduce(state, { type: "undo" });
    expect(once.rows).toEqual([[0], []]);
    expect(once.selected).toBe(1);
    const twice = reduce(once, { type: "undo" });
    expect(twice.rows).toEqual([[], []]);
    expect(twice.selected).toBe(0);
    expect(canUndo(twice)).toBe(false);
    expect(reduce(twice, { type: "undo" })).toBe(twice);
  });

  it("undoes a move between tiers without picking anything", () => {
    const state = run(
      init(2, 2),
      { type: "place", item: 0, tier: 0 },
      { type: "place", item: 0, tier: 1 },
    );
    const back = reduce(state, { type: "undo" });
    expect(back.rows).toEqual([[0], []]);
    expect(back.selected).toBeNull();
  });

  it("picks the next card of the pool after the picked one is placed", () => {
    const first = run(init(2, 4), { type: "select", item: 1 }, { type: "place", item: 1, tier: 0 });
    expect(first.selected).toBe(2);
    const second = reduce(first, { type: "place", item: 2, tier: 1 });
    expect(second.selected).toBe(3);
    // The last card of the pool hands over to the first one still there.
    const wrapped = reduce(second, { type: "place", item: 3, tier: 1 });
    expect(wrapped.selected).toBe(0);
    const done = reduce(wrapped, { type: "place", item: 0, tier: 0 });
    expect(done.selected).toBeNull();
    expect(pool(done)).toEqual([]);
  });

  it("picks nothing after a drag, or after a placed card changes its tier", () => {
    const dragged = run(init(2, 3), { type: "place", item: 0, tier: 0 });
    expect(dragged.selected).toBeNull();
    const draggedPastThePick = run(
      init(2, 3),
      { type: "select", item: 2 },
      { type: "place", item: 0, tier: 0 },
    );
    expect(draggedPastThePick.selected).toBeNull();
    const moved = run(dragged, { type: "select", item: 0 }, { type: "place", item: 0, tier: 1 });
    expect(moved.rows).toEqual([[], [0]]);
    expect(moved.selected).toBeNull();
  });

  it("keeps only the last few hundred steps", () => {
    let state = init(2, 1);
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      state = reduce(state, { type: "place", item: 0, tier: i % 2 });
    }
    expect(state.history).toHaveLength(MAX_HISTORY);
  });

  it("maps number keys to the first nine tiers only", () => {
    expect(tierForKey("1", 5)).toBe(0);
    expect(tierForKey("5", 5)).toBe(4);
    expect(tierForKey("6", 5)).toBeNull();
    expect(tierForKey("9", 20)).toBe(8);
    expect(tierForKey("0", 20)).toBeNull();
    expect(tierForKey("a", 20)).toBeNull();
    expect(tierForKey("12", 20)).toBeNull();
  });
});
