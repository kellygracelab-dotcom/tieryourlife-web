import { describe, expect, it } from "vitest";
import {
  addTier,
  addToPool,
  arrangeBoards,
  arrangeItems,
  BOARD_LIMITS,
  dropItem,
  editTier,
  itemsIn,
  liveItems,
  moveItem,
  newBoard,
  nextTierLabel,
  poolCount,
  poolTier,
  previewsOf,
  rankedCount,
  rankedTiers,
  removeTier,
  rename,
  reorderTiers,
  restoreBoard,
  restoreItem,
  restoreTier,
  setCover,
  setFavourite,
  shouldGroup,
  tierShares,
  trashBoard,
  trashEntriesOf,
  trashItem,
  withoutTrash,
  type Board,
} from "./model";

/** Uids a test can read: t0…t5 for the tiers, then i0, i1… for the cards. */
const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const board = (now = 1000): { board: Board; next: () => string } => {
  const next = uids();
  return { board: newBoard("board", "Films", now, next), next };
};

const titlesIn = (b: Board, tierUid: string) => itemsIn(b, tierUid).map((item) => item.title);

describe("a new board", () => {
  it("starts with the phone's five lettered tiers, no captions, and an empty pool last", () => {
    const { board: b } = board();
    expect(rankedTiers(b).map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(rankedTiers(b).every((tier) => tier.caption === null)).toBe(true);
    expect(rankedTiers(b).map((tier) => tier.colorLight)).toEqual([
      "#B03A32",
      "#C06A25",
      "#A98B1F",
      "#3F7F55",
      "#3C6E99",
    ]);
    const pool = poolTier(b);
    expect(pool?.isPool).toBe(true);
    expect(pool?.position).toBe(5);
    expect(b.items).toEqual([]);
    expect(b.editedAt).toBe(1000);
    expect(b.deletedAt).toBeNull();
  });

  it("clips a long title to what the account keeps", () => {
    const b = rename(board().board, "x".repeat(100), 2000);
    expect(b.title).toHaveLength(BOARD_LIMITS.title);
    expect(b.editedAt).toBe(2000);
    // The same name again is not an edit.
    expect(rename(b, b.title, 3000)).toBe(b);
  });
});

describe("cards", () => {
  it("land in the pool in the order given, named, and the board is touched", () => {
    const { board: b0, next } = board();
    const b = addToPool(
      b0,
      [
        { title: "Dune", imageUrl: "https://x/dune.jpg", source: "TMDB" },
        { title: "  ", imageUrl: null },
        { title: "Heat", imageUrl: null },
      ],
      2000,
      next,
    );
    const pool = poolTier(b)!.uid;
    expect(titlesIn(b, pool)).toEqual(["Dune", "Heat"]);
    expect(itemsIn(b, pool).map((item) => item.position)).toEqual([0, 1]);
    expect(itemsIn(b, pool)[0]?.source).toBe("TMDB");
    expect(itemsIn(b, pool)[1]?.source).toBe("MANUAL");
    expect(b.editedAt).toBe(2000);
    expect(poolCount(b)).toBe(2);
    expect(rankedCount(b)).toBe(0);
  });

  it("refuse to go past the account's ceiling", () => {
    const { board: b0, next } = board();
    const many = Array.from({ length: BOARD_LIMITS.items + 5 }, (_, i) => ({
      title: `c${i}`,
      imageUrl: null,
    }));
    expect(liveItems(addToPool(b0, many, 1, next))).toHaveLength(BOARD_LIMITS.items);
  });

  it("move between tiers and along one, in reading order, and the rows renumber", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b", "c"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [s, a] = rankedTiers(b1);
    const pool = poolTier(b1)!;
    const [ia, ib, ic] = itemsIn(b1, pool.uid);
    const b2 = moveItem(b1, ia!.uid, s!.uid, 0, 2);
    const b3 = moveItem(b2, ib!.uid, s!.uid, 0, 3);
    expect(titlesIn(b3, s!.uid)).toEqual(["b", "a"]);
    expect(titlesIn(b3, pool.uid)).toEqual(["c"]);
    expect(itemsIn(b3, pool.uid)[0]?.position).toBe(0);
    // Along the row: a to the front.
    const b4 = moveItem(b3, ia!.uid, s!.uid, 0, 4);
    expect(titlesIn(b4, s!.uid)).toEqual(["a", "b"]);
    // Past the end means last; the same place again changes nothing.
    const b5 = moveItem(b4, ic!.uid, a!.uid, 99, 5);
    expect(titlesIn(b5, a!.uid)).toEqual(["c"]);
    expect(moveItem(b5, ic!.uid, a!.uid, 0, 6)).toBe(b5);
    // A tier that is not there, or a card that is not: nothing happens.
    expect(moveItem(b5, ic!.uid, "nowhere", 0, 7)).toBe(b5);
    expect(moveItem(b5, "nobody", s!.uid, 0, 7)).toBe(b5);
  });

  it("take a whole arrangement from the board on screen, and keep the pool's order", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b", "c", "d"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [s, a] = rankedTiers(b1);
    const pool = poolTier(b1)!;
    const [ia, ib, ic, id] = itemsIn(b1, pool.uid).map((item) => item.uid);
    const b2 = arrangeItems(b1, [[ic!, ia!], [id!], [], [], []], 2);
    expect(titlesIn(b2, s!.uid)).toEqual(["c", "a"]);
    expect(titlesIn(b2, a!.uid)).toEqual(["d"]);
    expect(titlesIn(b2, pool.uid)).toEqual(["b"]);
    expect(b2.editedAt).toBe(2);
    // The same rows again: the same board, untouched.
    expect(arrangeItems(b2, [[ic!, ia!], [id!], [], [], []], 3)).toBe(b2);
    // Back to the pool: after the cards already there.
    const b3 = arrangeItems(b2, [[ia!], [], [], [], []], 4);
    expect(titlesIn(b3, pool.uid)).toEqual(["b", "c", "d"]);
    // A uid the board does not have is ignored; a card named twice is placed once.
    const b4 = arrangeItems(b3, [["ghost", ib!, ib!], [], [], [], []], 5);
    expect(titlesIn(b4, s!.uid)).toEqual(["b"]);
  });

  it("go to the trash keeping their place, and come back to it", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b", "c"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const s = rankedTiers(b1)[0]!;
    const pool = poolTier(b1)!;
    const [ia, ib, ic] = itemsIn(b1, pool.uid).map((item) => item.uid);
    const b2 = arrangeItems(b1, [[ia!, ib!, ic!], [], [], [], []], 2);
    const b3 = trashItem(b2, ib!, 3);
    expect(titlesIn(b3, s.uid)).toEqual(["a", "c"]);
    expect(itemsIn(b3, s.uid).map((item) => item.position)).toEqual([0, 1]);
    expect(b3.items.find((item) => item.uid === ib)?.deletedAt).toBe(3);
    expect(trashEntriesOf([b3])).toMatchObject([{ kind: "item", wasInPool: false }]);
    // Restored between a and c, where it was.
    const b4 = restoreItem(b3, ib!, 4);
    expect(titlesIn(b4, s.uid)).toEqual(["a", "b", "c"]);
    expect(trashEntriesOf([b4])).toEqual([]);
    // Trashing twice is once; restoring what is not in the trash is nothing.
    expect(trashItem(b3, ib!, 5)).toBe(b3);
    expect(restoreItem(b4, ib!, 5)).toBe(b4);
    // Dropped for good.
    const b5 = dropItem(trashItem(b4, ia!, 6), ia!);
    expect(b5.items.map((item) => item.title).sort()).toEqual(["b", "c"]);
  });

  it("come back to the pool when their tier has gone meanwhile", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(b0, [{ title: "a", imageUrl: null }], 1, next);
    const s = rankedTiers(b1)[0]!;
    const ia = liveItems(b1)[0]!.uid;
    const b2 = trashItem(moveItem(b1, ia, s.uid, 0, 2), ia, 3);
    const b3 = removeTier(b2, s.uid, 4);
    const b4 = restoreItem(b3, ia, 5);
    expect(titlesIn(b4, poolTier(b4)!.uid)).toEqual(["a"]);
  });
});

describe("tiers", () => {
  it("are added at the end with the next letter, the pool staying last", () => {
    const { board: b0, next } = board();
    expect(nextTierLabel(b0)).toBe("E");
    const b1 = addTier(
      b0,
      { label: "E", caption: " fine ", colorLight: "#111111", colorDark: "#eeeeee" },
      2,
      next,
    );
    expect(rankedTiers(b1).map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D", "E"]);
    expect(rankedTiers(b1)[5]?.caption).toBe("fine");
    expect(poolTier(b1)?.position).toBe(6);
    expect(nextTierLabel(b1)).toBe("F");
    // Not past the ceiling, and not without a label.
    let b = b1;
    for (let i = 0; i < 20; i++) {
      b = addTier(
        b,
        { label: `t${i}`, caption: null, colorLight: "#111111", colorDark: "#eeeeee" },
        3,
        next,
      );
    }
    expect(rankedTiers(b)).toHaveLength(BOARD_LIMITS.tiers);
    expect(
      addTier(
        b1,
        { label: " ", caption: null, colorLight: "#111111", colorDark: "#eeeeee" },
        3,
        next,
      ),
    ).toBe(b1);
  });

  it("are renamed, captioned and recoloured, but the pool is not", () => {
    const { board: b0 } = board();
    const s = rankedTiers(b0)[0]!;
    const b1 = editTier(
      b0,
      s.uid,
      { label: "Top", caption: "", colorLight: "#000000", colorDark: "#ffffff" },
      2,
    );
    expect(rankedTiers(b1)[0]).toMatchObject({
      label: "Top",
      caption: null,
      colorLight: "#000000",
    });
    expect(
      editTier(
        b1,
        s.uid,
        { label: "Top", caption: null, colorLight: "#000000", colorDark: "#ffffff" },
        3,
      ),
    ).toBe(b1);
    const pool = poolTier(b0)!;
    expect(
      editTier(
        b0,
        pool.uid,
        { label: "x", caption: null, colorLight: "#000000", colorDark: "#ffffff" },
        2,
      ),
    ).toBe(b0);
  });

  it("go away with their cards to the pool, and come back with them", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b", "c"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [s, a] = rankedTiers(b1);
    const pool = poolTier(b1)!;
    const [ia, ib] = itemsIn(b1, pool.uid).map((item) => item.uid);
    const b2 = arrangeItems(b1, [[ia!], [ib!], [], [], []], 2);
    const b3 = removeTier(b2, s!.uid, 3);
    expect(rankedTiers(b3).map((tier) => tier.label)).toEqual(["A", "B", "C", "D"]);
    expect(rankedTiers(b3).map((tier) => tier.position)).toEqual([0, 1, 2, 3]);
    expect(poolTier(b3)?.position).toBe(4);
    expect(titlesIn(b3, pool.uid)).toEqual(["c", "a"]);
    expect(titlesIn(b3, a!.uid)).toEqual(["b"]);
    const b4 = restoreTier(b3, s!, [ia!], 4);
    expect(rankedTiers(b4).map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(titlesIn(b4, s!.uid)).toEqual(["a"]);
    expect(titlesIn(b4, pool.uid)).toEqual(["c"]);
    expect(poolTier(b4)?.position).toBe(5);
    // The last tier stays; the pool cannot go.
    let one = b4;
    for (const tier of rankedTiers(b4).slice(1)) one = removeTier(one, tier.uid, 5);
    expect(rankedTiers(one)).toHaveLength(1);
    expect(removeTier(one, rankedTiers(one)[0]!.uid, 6)).toBe(one);
    expect(removeTier(one, pool.uid, 6)).toBe(one);
  });

  it("are reordered, with a tier not named keeping to the end", () => {
    const { board: b0 } = board();
    const [s, a, b, c, d] = rankedTiers(b0).map((tier) => tier.uid);
    const b1 = reorderTiers(b0, [d!, c!, "ghost", s!], 2);
    expect(rankedTiers(b1).map((tier) => tier.label)).toEqual(["D", "C", "S", "A", "B"]);
    expect(rankedTiers(b1).map((tier) => tier.position)).toEqual([0, 1, 2, 3, 4]);
    expect(reorderTiers(b1, [d!, c!, s!, a!, b!], 3)).toBe(b1);
  });
});

describe("the board's card", () => {
  it("counts what is ranked and what waits, and shares the bar among the tiers", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b", "c"].map((title, i) => ({ title, imageUrl: i === 0 ? "https://x/a.jpg" : null })),
      1,
      next,
    );
    const [ia, ib] = liveItems(b1).map((item) => item.uid);
    const b2 = arrangeItems(b1, [[ia!], [ib!], [], [], []], 2);
    expect(rankedCount(b2)).toBe(2);
    expect(poolCount(b2)).toBe(1);
    expect(tierShares(b2).map((share) => share.count)).toEqual([1, 1, 0, 0, 0]);
    expect(previewsOf(b2)).toEqual(["https://x/a.jpg"]);
  });
});

describe("the list of boards", () => {
  const at = (uid: string, editedAt: number, extra: Partial<Board> = {}): Board => ({
    ...newBoard(uid, uid, editedAt, uids()),
    ...extra,
  });

  it("puts starred boards first by the time they were starred, then the rest newest first", () => {
    const boards = [
      at("old", 1),
      at("new", 3),
      at("star1", 2, { favouritedAt: 10 }),
      at("star2", 0, { favouritedAt: 20 }),
      at("gone", 5, { deletedAt: 6 }),
    ];
    const arranged = arrangeBoards(boards, "newest");
    expect(arranged.favourites.map((b) => b.uid)).toEqual(["star2", "star1"]);
    expect(arranged.rest.map((b) => b.uid)).toEqual(["new", "old"]);
    expect(arrangeBoards(boards, "oldest").rest.map((b) => b.uid)).toEqual(["old", "new"]);
    expect(shouldGroup(arranged, false)).toBe(true);
    expect(shouldGroup(arranged, true)).toBe(false);
    expect(shouldGroup(arrangeBoards([at("x", 1)], "newest"), false)).toBe(false);
  });

  it("narrows by category, by whether it is public, and by words in the name", () => {
    const boards = [
      at("films", 1, { category: "film_tv", publishedId: "p1" }),
      at("games", 2, { category: "games" }),
      at("Pizza in Lisbon", 3),
    ];
    const ids = (filters: Parameters<typeof arrangeBoards>[2]) =>
      arrangeBoards(boards, "newest", filters).rest.map((b) => b.uid);
    expect(ids({ category: "games" })).toEqual(["games"]);
    expect(ids({ published: "public" })).toEqual(["films"]);
    expect(ids({ published: "private" })).toEqual(["Pizza in Lisbon", "games"]);
    expect(ids({ query: "PIZ" })).toEqual(["Pizza in Lisbon"]);
    expect(ids({ query: "  " })).toHaveLength(3);
  });

  it("stars and unstars without touching the edit time", () => {
    const b = at("x", 1);
    const starred = setFavourite(b, 9);
    expect(starred.favouritedAt).toBe(9);
    expect(starred.editedAt).toBe(1);
    expect(setFavourite(starred, 9)).toBe(starred);
    expect(setFavourite(starred, null).favouritedAt).toBeNull();
  });

  it("keeps up to six chosen pictures for the cover, one alone being the cover itself", () => {
    const b = at("x", 1);
    const one = setCover(b, ["https://x/1.jpg"], 2);
    expect(one.coverImageUrl).toBe("https://x/1.jpg");
    const many = setCover(
      one,
      Array.from({ length: 8 }, (_, i) => `https://x/${i}.jpg`),
      3,
    );
    expect(many.coverImageUrls).toHaveLength(6);
    expect(many.coverImageUrl).toBeNull();
    expect(setCover(many, many.coverImageUrls, 4)).toBe(many);
  });
});

describe("the trash", () => {
  it("lists deleted boards and the deleted cards of live boards, newest first, and empties", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [ia] = liveItems(b1).map((item) => item.uid);
    const live = trashItem(b1, ia!, 5);
    const gone = trashBoard(newBoard("other", "Other", 1, uids()), 7);
    const entries = trashEntriesOf([live, gone]);
    expect(entries.map((entry) => entry.kind)).toEqual(["board", "item"]);
    expect(entries[0]).toMatchObject({ kind: "board", deletedAt: 7, itemCount: 0 });
    expect(entries[1]).toMatchObject({ kind: "item", deletedAt: 5, wasInPool: true });
    expect(restoreBoard(gone, 8).deletedAt).toBeNull();
    expect(restoreBoard(live, 8)).toBe(live);
    expect(trashBoard(gone, 9)).toBe(gone);

    const emptied = withoutTrash([live, gone]);
    expect(emptied.map((b) => b.uid)).toEqual(["board"]);
    expect(emptied[0]?.items.map((item) => item.title)).toEqual(["b"]);
    // Nothing in the trash: the same boards back.
    expect(withoutTrash([b1])[0]).toBe(b1);
  });
});
