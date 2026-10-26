import { describe, expect, it } from "vitest";
import {
  addToPool,
  arrangeItems,
  itemsIn,
  liveItems,
  newBoard,
  poolTier,
  rankedTiers,
  restoreTier,
} from "./model";
import { applyTierAction, editorTiersOf } from "./tierEditing";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const labels = (b: ReturnType<typeof newBoard>) => rankedTiers(b).map((tier) => tier.label);

describe("tier editing on a board", () => {
  it("hands the editor the ranked tiers by uid, the pool left out", () => {
    const b = newBoard("b", "x", 1, uids());
    const tiers = editorTiersOf(b);
    expect(tiers.map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(tiers.map((tier) => tier.key)).toEqual(rankedTiers(b).map((tier) => tier.uid));
  });

  it("adds a tier with the next letter and the next preset, and reorders by arrows or by place", () => {
    const next = uids();
    const b0 = newBoard("b", "x", 1, next);
    const b1 = applyTierAction(b0, { type: "addTier" }, 2, next).board;
    expect(labels(b1)).toEqual(["S", "A", "B", "C", "D", "E"]);
    expect(rankedTiers(b1)[5]?.colorLight).toBe("#6B4E9E");
    const [s, , , , d, e] = rankedTiers(b1).map((tier) => tier.uid);
    const b2 = applyTierAction(b1, { type: "moveTier", key: e!, by: -1 }, 3, next).board;
    expect(labels(b2)).toEqual(["S", "A", "B", "C", "E", "D"]);
    const b3 = applyTierAction(b2, { type: "placeTier", key: s!, index: 5 }, 4, next).board;
    expect(labels(b3)).toEqual(["A", "B", "C", "E", "D", "S"]);
    expect(applyTierAction(b3, { type: "placeTier", key: d!, index: 9 }, 5, next).board).toBe(b3);
    expect(applyTierAction(b3, { type: "moveTier", key: "ghost", by: 1 }, 5, next).board).toBe(b3);
  });

  it("renames and recolours, but an emptied label is held by the editor, not kept", () => {
    const next = uids();
    const b0 = newBoard("b", "x", 1, next);
    const s = rankedTiers(b0)[0]!.uid;
    const b1 = applyTierAction(
      b0,
      { type: "renameTier", key: s, label: "Top", caption: "the best" },
      2,
      next,
    ).board;
    expect(rankedTiers(b1)[0]).toMatchObject({ label: "Top", caption: "the best" });
    expect(
      applyTierAction(b1, { type: "renameTier", key: s, label: "  ", caption: "x" }, 3, next).board,
    ).toBe(b1);
    const b2 = applyTierAction(
      b1,
      { type: "recolourTier", key: s, colorLight: "#111111", colorDark: "#eeeeee" },
      4,
      next,
    ).board;
    expect(rankedTiers(b2)[0]).toMatchObject({
      label: "Top",
      colorLight: "#111111",
      colorDark: "#eeeeee",
    });
  });

  it("removes a tier, its cards to the pool, and says what Undo needs to put it back", () => {
    const next = uids();
    const b0 = addToPool(
      newBoard("b", "x", 1, next),
      ["a", "b"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [ia, ib] = liveItems(b0).map((item) => item.uid);
    const [s, a] = rankedTiers(b0);
    const b1 = arrangeItems(b0, [[ia!], [ib!], [], [], []], 2);
    const change = applyTierAction(b1, { type: "removeTier", key: s!.uid }, 3, next);
    expect(labels(change.board)).toEqual(["A", "B", "C", "D"]);
    expect(change.removed).toEqual({ tier: s, itemUids: [ia] });
    expect(itemsIn(change.board, poolTier(change.board)!.uid).map((i) => i.title)).toEqual(["a"]);
    const back = restoreTier(change.board, change.removed!.tier, change.removed!.itemUids, 4);
    expect(labels(back)).toEqual(["S", "A", "B", "C", "D"]);
    expect(itemsIn(back, s!.uid).map((i) => i.title)).toEqual(["a"]);
    expect(itemsIn(back, a!.uid).map((i) => i.title)).toEqual(["b"]);
    // Nothing happens to a tier that is not there, and the editor's other actions are not for here.
    expect(applyTierAction(b1, { type: "removeTier", key: "ghost" }, 5, next)).toEqual({
      board: b1,
    });
    expect(applyTierAction(b1, { type: "title", title: "x" }, 5, next)).toEqual({ board: b1 });
  });
});
