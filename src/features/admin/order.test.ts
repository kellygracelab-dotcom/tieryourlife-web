import { describe, expect, it } from "vitest";
import { changesOf, isChanged, moveRow, saveOf, setShown, type OrderRow } from "./order";

const rows = (...ids: string[]): OrderRow[] => ids.map((id) => ({ id, shown: true }));
const ids = (list: readonly OrderRow[]) => list.map((row) => row.id);

describe("the section order", () => {
  it("moves a row up and down", () => {
    const start = rows("anime", "games", "food", "other");
    expect(ids(moveRow(start, 2, 0))).toEqual(["food", "anime", "games", "other"]);
    expect(ids(moveRow(start, 0, 2))).toEqual(["games", "food", "anime", "other"]);
  });

  it("keeps Other last: it does not move, and nothing passes it", () => {
    const start = rows("anime", "games", "other");
    expect(ids(moveRow(start, 2, 0))).toEqual(["anime", "games", "other"]);
    expect(ids(moveRow(start, 0, 5))).toEqual(["games", "anime", "other"]);
    expect(ids(setShown(start, "other", false))).toEqual(["anime", "games", "other"]);
    expect(setShown(start, "other", false)[2]?.shown).toBe(true);
  });

  it("says what changed against the saved order, and what a Save sends", () => {
    const saved = rows("anime", "games", "food", "other");
    expect(isChanged(changesOf(saved, saved))).toBe(false);
    const edited = setShown(moveRow(saved, 2, 0), "games", false);
    expect(changesOf(saved, edited)).toEqual({ moved: true, toggled: 1, hidden: 1 });
    expect(saveOf(edited)).toEqual({ ids: ["food", "anime", "games", "other"], hidden: ["games"] });
    // Hiding and showing again is no change.
    expect(
      isChanged(changesOf(saved, setShown(setShown(saved, "food", false), "food", true))),
    ).toBe(false);
  });
});
