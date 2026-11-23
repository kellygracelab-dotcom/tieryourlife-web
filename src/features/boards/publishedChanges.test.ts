import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { addToPool, liveItems, moveItem, newBoard, rankedTiers, rename, type Board } from "./model";
import { publishRequestOf } from "./publish";
import { changesAgainst, sameAsPublished } from "./publishedChanges";

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

/** The list as a publish of the board would have made it, pictures under other addresses. */
const published = (b: Board): PublishedList => {
  const request = publishRequestOf(b)!;
  return {
    title: request.title,
    category: request.category,
    tiers: request.tiers,
    items: request.items.map((item) => ({
      title: item.title,
      imageUrl:
        item.imageUrl === null && item.pictureId === null ? null : "https://copy/w-hash_p_1.webp",
      tierIndex: item.tierIndex,
    })),
  } as unknown as PublishedList;
};

describe("sameAsPublished", () => {
  const out = (): Board => ({ ...board(), category: "film_tv" });

  it("says so when the list shows the board, whatever addresses its pictures have", () => {
    const b = out();
    const pictured = {
      ...b,
      items: b.items.map((item) => ({ ...item, imageUrl: `https://elsewhere/${item.title}.jpg` })),
    };
    expect(sameAsPublished(b, published(b))).toBe(true);
    expect(sameAsPublished(pictured, published(pictured))).toBe(true);
  });

  it("does not, for a new name, a card moved or reordered, a tier renamed or a picture taken off", () => {
    const b = out();
    const list = published(b);
    expect(sameAsPublished(rename(b, "Films I love", 5), list)).toBe(false);
    const [dune, heat] = liveItems(b);
    const s = rankedTiers(b)[0]!.uid;
    const a = rankedTiers(b)[1]!.uid;
    expect(sameAsPublished(moveItem(b, dune!.uid, a, 0, 5), list)).toBe(false);
    expect(sameAsPublished(moveItem(b, heat!.uid, s, 0, 5), list)).toBe(false);
    const relabelled = {
      ...b,
      tiers: b.tiers.map((tier) => (tier.uid === s ? { ...tier, label: "Best" } : tier)),
    };
    expect(sameAsPublished(relabelled, list)).toBe(false);
    const pictured = {
      ...b,
      items: b.items.map((item) => ({ ...item, imageUrl: "https://p/1.jpg" })),
    };
    expect(sameAsPublished(b, published(pictured))).toBe(false);
  });
});
