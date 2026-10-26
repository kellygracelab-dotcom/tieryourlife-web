import { describe, expect, it } from "vitest";
import { agoOf } from "./ago";
import { addToPool, arrangeItems, liveItems, newBoard } from "./model";
import { boardView, uidRows } from "./view";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

describe("boardView", () => {
  it("lays the cards out as the ranking board draws them: rows by tier, the pool after, uids kept beside", () => {
    const next = uids();
    const b0 = addToPool(
      newBoard("b", "", 1, next),
      ["a", "b", "c", "d"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [ia, ib, ic] = liveItems(b0).map((item) => item.uid);
    const b1 = arrangeItems(b0, [[ic!, ia!], [ib!], [], [], []], 2);
    const view = boardView(b1, "Untitled list");
    expect(view.list.title).toBe("Untitled list");
    expect(view.list.tiers.map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(view.list.items.map((item) => item.title)).toEqual(["c", "a", "b", "d"]);
    expect(view.rows).toEqual([[0, 1], [2], [], [], []]);
    expect(view.uids).toEqual([ic, ia, ib, liveItems(b0)[3]?.uid]);
    expect(uidRows(view, [[1], [0, 9], [], [], []])).toEqual([[ia], [ic], [], [], []]);
  });

  it("keeps the cards' indexes from the view drawn before, while the cards are the same", () => {
    const next = uids();
    const b0 = addToPool(
      newBoard("b", "", 1, next),
      ["a", "b", "c"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [ia, ib, ic] = liveItems(b0).map((item) => item.uid);
    const before = boardView(arrangeItems(b0, [[ia!, ib!, ic!], [], [], [], []], 2), "");
    // c moved to the front of its row: the rows change, the indexes do not.
    const moved = arrangeItems(b0, [[ic!, ia!, ib!], [], [], [], []], 3);
    const after = boardView(moved, "", before.uids);
    expect(after.uids).toEqual(before.uids);
    expect(after.rows[0]).toEqual([2, 0, 1]);
    expect(after.list.items.map((item) => item.title)).toEqual(["a", "b", "c"]);
    // A card more, and the order starts afresh: the ranking board starts over anyway.
    const more = addToPool(moved, [{ title: "d", imageUrl: null }], 4, next);
    expect(boardView(more, "", before.uids).list.items.map((item) => item.title)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });
});

describe("agoOf", () => {
  it("is coarse on purpose", () => {
    const now = 1_000_000_000;
    expect(agoOf(now - 10_000, now)).toEqual({ kind: "justNow" });
    expect(agoOf(now - 5 * 60_000, now)).toEqual({ kind: "minutes", n: 5 });
    expect(agoOf(now - 3 * 3_600_000, now)).toEqual({ kind: "hours", n: 3 });
    expect(agoOf(now - 30 * 3_600_000, now)).toEqual({ kind: "yesterday" });
    expect(agoOf(now - 5 * 86_400_000, now)).toEqual({ kind: "days", n: 5 });
    expect(agoOf(now + 100, now)).toEqual({ kind: "justNow" });
  });
});
