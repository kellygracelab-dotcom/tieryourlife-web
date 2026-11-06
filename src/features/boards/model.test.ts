import { describe, expect, it } from "vitest";
import {
  addTier,
  addToPool,
  arrangeBoards,
  arrangeItems,
  BOARD_LIMITS,
  editTier,
  isNarrowed,
  itemsIn,
  liveItems,
  markedTitle,
  MAX_RANKED_TIERS,
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
  setCategory,
  setCover,
  setFavourite,
  setTopic,
  shouldGroup,
  tierShares,
  trashBoard,
  trashEntriesOf,
  putBack,
  removeItem,
  withoutTrash,
  type Board,
} from "./model";
import { parseBoard } from "./repository";
import { setStrings } from "../../strings";

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
    // The phone's name: the account refuses a tier with none.
    expect(pool?.label).toBe("Unranked");
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

  it("trims a title, keeps the old one for an empty one, and never halves an emoji", () => {
    const b = board().board;
    expect(rename(b, "   Spaced   out   ", 2000).title).toBe("Spaced out");
    expect(rename(b, "   ", 2000)).toBe(b);
    const long = `${"a".repeat(BOARD_LIMITS.title - 1)}😀tail`;
    expect(rename(b, long, 2000).title).toBe("a".repeat(BOARD_LIMITS.title - 1));
    expect(newBoard("n", long, 1000, () => "t").title).toBe("a".repeat(BOARD_LIMITS.title - 1));
  });

  it("gives way to a mark that tells it apart, so the account keeps the mark", () => {
    expect(markedTitle("Films", "(from this device)")).toBe("Films (from this device)");
    const marked = markedTitle("x".repeat(BOARD_LIMITS.title), "(from this device)");
    expect(marked).toHaveLength(BOARD_LIMITS.title);
    expect(marked.endsWith(" (from this device)")).toBe(true);
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

  it("are removed for good, not to the trash, and Undo puts them back where they were", () => {
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
    const card = b2.items.find((item) => item.uid === ib)!;
    const b3 = removeItem(b2, ib!, 3);
    expect(titlesIn(b3, s.uid)).toEqual(["a", "c"]);
    expect(itemsIn(b3, s.uid).map((item) => item.position)).toEqual([0, 1]);
    expect(b3.items.some((item) => item.uid === ib)).toBe(false);
    expect(b3.editedAt).toBe(3);
    expect(trashEntriesOf([b3])).toEqual([]);
    // Undo: back between a and c, where it was.
    const b4 = putBack(b3, card, 4);
    expect(titlesIn(b4, s.uid)).toEqual(["a", "b", "c"]);
    expect(b4.items.find((item) => item.uid === ib)?.deletedAt).toBeNull();
    // Removing what is not there, or putting back what is, is nothing.
    expect(removeItem(b3, ib!, 5)).toBe(b3);
    expect(putBack(b4, card, 5)).toBe(b4);
  });

  it("take their picture off the cover, unless another card still shows it", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      [
        { title: "holiday", imageUrl: "https://x/h.jpg" },
        { title: "poster", imageUrl: "https://x/p.jpg" },
        { title: "poster again", imageUrl: "https://x/p.jpg" },
      ],
      1,
      next,
    );
    const [holiday, poster] = liveItems(b1).map((item) => item.uid);
    const covered = setCover(b1, ["https://x/h.jpg"], 2);
    const gone = removeItem(covered, holiday!, 3);
    expect(gone.coverImageUrls).toEqual([]);
    expect(gone.coverImageUrl).toBeNull();
    const collage = setCover(b1, ["https://x/h.jpg", "https://x/p.jpg"], 2);
    expect(removeItem(collage, holiday!, 3)).toMatchObject({
      coverImageUrls: ["https://x/p.jpg"],
      coverImageUrl: "https://x/p.jpg",
    });
    expect(removeItem(collage, poster!, 3).coverImageUrls).toEqual(collage.coverImageUrls);
  });

  it("bring their picture back into the cover on Undo, in its old place", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      [
        { title: "one", imageUrl: "https://x/1.jpg" },
        { title: "two", imageUrl: "https://x/2.jpg" },
        { title: "three", imageUrl: "https://x/3.jpg" },
      ],
      1,
      next,
    );
    const two = liveItems(b1).find((item) => item.title === "two")!;
    const collage = setCover(b1, ["https://x/2.jpg", "https://x/1.jpg", "https://x/3.jpg"], 2);
    const gone = removeItem(collage, two.uid, 3);
    expect(gone.coverImageUrls).toEqual(["https://x/1.jpg", "https://x/3.jpg"]);
    const back = putBack(gone, two, 4, collage.coverImageUrls);
    expect(back.coverImageUrls).toEqual(collage.coverImageUrls);
    expect(back.coverImageUrl).toBeNull();
    // A cover the card was never part of stays as it is.
    expect(putBack(removeItem(b1, two.uid, 3), two, 4, []).coverImageUrls).toEqual([]);
  });

  it("come back to the pool on Undo when their tier has gone meanwhile", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(b0, [{ title: "a", imageUrl: null }], 1, next);
    const s = rankedTiers(b1)[0]!;
    const ia = liveItems(b1)[0]!.uid;
    const b2 = moveItem(b1, ia, s.uid, 0, 2);
    const card = b2.items.find((item) => item.uid === ia)!;
    const b3 = removeTier(removeItem(b2, ia, 3), s.uid, 4);
    const b4 = putBack(b3, card, 5);
    expect(titlesIn(b4, poolTier(b4)!.uid)).toEqual(["a"]);
  });
});

/** A card in the trash as a device from before, or the phone, may still send one. */
const trashedElsewhere = (board: Board, itemUid: string, at: number): Board => ({
  ...board,
  items: board.items.map((item) => (item.uid === itemUid ? { ...item, deletedAt: at } : item)),
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
    // Not past the ceiling the account keeps, the pool counted among the tiers, and not without a label.
    let b = b1;
    for (let i = 0; i < 20; i++) {
      b = addTier(
        b,
        { label: `t${i}`, caption: null, colorLight: "#111111", colorDark: "#eeeeee" },
        3,
        next,
      );
    }
    expect(rankedTiers(b)).toHaveLength(MAX_RANKED_TIERS);
    expect(b.tiers).toHaveLength(BOARD_LIMITS.tiers);
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

  it("take their trashed cards to the pool when they go, so the trash keeps them", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(b0, [{ title: "a", imageUrl: null }], 1, next);
    const [s] = rankedTiers(b1);
    const pool = poolTier(b1)!;
    const [ia] = itemsIn(b1, pool.uid).map((item) => item.uid);
    const b2 = trashedElsewhere(arrangeItems(b1, [[ia!], [], [], [], []], 2), ia!, 3);
    const b3 = removeTier(b2, s!.uid, 4);
    const trashed = b3.items.find((item) => item.uid === ia);
    expect(trashed).toMatchObject({ tierUid: pool.uid });
    expect(trashed?.deletedAt).toBe(3);
    // Read back as the account and this browser read it: the card is still there, in the trash.
    const again = parseBoard(JSON.parse(JSON.stringify(b3)));
    expect(again?.items.find((item) => item.uid === ia)?.deletedAt).toBe(3);
    // Restored, it comes back to the pool.
    expect(titlesIn(restoreItem(again!, ia!, 5), pool.uid)).toEqual(["a"]);
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
    const arranged = arrangeBoards(boards, "recent");
    expect(arranged.favourites.map((b) => b.uid)).toEqual(["star2", "star1"]);
    expect(arranged.rest.map((b) => b.uid)).toEqual(["new", "old"]);
    expect(shouldGroup(arranged, false)).toBe(true);
    expect(shouldGroup(arranged, true)).toBe(false);
    expect(shouldGroup(arrangeBoards([at("x", 1)], "recent"), false)).toBe(false);
  });

  it("orders the rest by name, by most ranked and by most in the pool, the last touch breaking ties", () => {
    /** A board with `ranked` cards in S and `waiting` in the pool. */
    const filled = (uid: string, editedAt: number, ranked: number, waiting: number) => {
      const next = uids();
      const b = addToPool(
        newBoard(uid, uid, editedAt, next),
        Array.from({ length: ranked + waiting }, (_, i) => ({ title: `c${i}`, imageUrl: null })),
        editedAt,
        next,
      );
      const s = liveItems(b)
        .slice(0, ranked)
        .map((item) => item.uid);
      return { ...arrangeItems(b, [s, [], [], [], []], editedAt), editedAt };
    };
    const boards = [
      filled("banana", 1, 1, 5),
      filled("Apple", 2, 4, 0),
      filled("cherry", 3, 0, 2),
      filled("apple", 4, 1, 1),
    ];
    const order = (sort: Parameters<typeof arrangeBoards>[1]) =>
      arrangeBoards(boards, sort).rest.map((b) => b.uid);
    expect(order("recent")).toEqual(["apple", "cherry", "Apple", "banana"]);
    expect(order("name")).toEqual(["apple", "Apple", "banana", "cherry"]);
    expect(order("ranked")).toEqual(["Apple", "apple", "banana", "cherry"]);
    expect(order("pool")).toEqual(["banana", "cherry", "apple", "Apple"]);
  });

  it("shows the ones in progress, the public ones and the copies of somebody else's, and narrows by words", () => {
    const next = uids();
    const waiting = addToPool(
      newBoard("waiting", "waiting", 4, next),
      [{ title: "a", imageUrl: null }],
      4,
      next,
    );
    const [card] = liveItems(waiting).map((item) => item.uid);
    const done = { ...arrangeItems(waiting, [[card!], [], [], [], []], 5), uid: "done" };
    const boards = [
      at("films", 1, { publishedId: "p1", authorName: "danylo" }),
      at("saved", 2, { authorName: "someone" }),
      at("Pizza in Lisbon", 3),
      waiting,
      done,
    ];
    const ids = (filters: Parameters<typeof arrangeBoards>[2]) =>
      arrangeBoards(boards, "recent", filters).rest.map((b) => b.uid);
    expect(ids({ show: "all" })).toHaveLength(5);
    // Nothing ranked yet, or something still in the pool; every card placed is done.
    expect(ids({ show: "inProgress" })).toEqual(["waiting", "Pizza in Lisbon", "saved", "films"]);
    expect(ids({ show: "public" })).toEqual(["films"]);
    // A list one published carries one's own name: it is not somebody else's.
    expect(ids({ show: "saved" })).toEqual(["saved"]);
    expect(ids({ query: "PIZ" })).toEqual(["Pizza in Lisbon"]);
    expect(ids({ query: "  " })).toHaveLength(5);
    expect(isNarrowed({ show: "all", query: " " })).toBe(false);
    expect(isNarrowed({ show: "saved" })).toBe(true);
    expect(isNarrowed({ query: "x" })).toBe(true);
  });

  it("finds a title typed without its capital İ or its accents", () => {
    const boards = [at("İstanbul Hatırası", 1), at("Pokémon cards", 2), at("Iğdır Ovası", 3)];
    const ids = (query: string) =>
      arrangeBoards(boards, "recent", { query }).rest.map((b) => b.uid);
    expect(ids("istanbul")).toEqual(["İstanbul Hatırası"]);
    expect(ids("pokemon")).toEqual(["Pokémon cards"]);
    expect(ids("ığdır")).toEqual(["Iğdır Ovası"]);
  });

  it("orders by name in the site's language, not the browser's", () => {
    const boards = ["Ćwiczenia", "Czytanie", "Śpiew", "Szachy"].map((title, i) => at(title, i));
    try {
      setStrings("pl", {});
      expect(arrangeBoards(boards, "name").rest.map((b) => b.uid)).toEqual([
        "Czytanie",
        "Ćwiczenia",
        "Szachy",
        "Śpiew",
      ]);
    } finally {
      setStrings("en", null);
    }
  });

  it("forgets the topic with the section it belongs to, and leaves the copy behind on a new one", () => {
    const b = { ...at("x", 1), category: "games" as const };
    const topic = { id: "t1", name: "Pokémon" };
    const withTopic = setTopic(b, topic, 2);
    expect(withTopic).toMatchObject({ topic, editedAt: 2 });
    expect(setTopic(withTopic, { ...topic }, 3)).toBe(withTopic);
    expect(setCategory(withTopic, "games", 4)).toBe(withTopic);
    expect(setCategory(withTopic, "anime", 4)).toMatchObject({ category: "anime", topic: null });
    expect(setTopic(withTopic, null, 5).topic).toBeNull();
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
  it("lists deleted boards only, newest first, and empties", () => {
    const { board: b0, next } = board();
    const b1 = addToPool(
      b0,
      ["a", "b"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [ia] = liveItems(b1).map((item) => item.uid);
    // A card trashed by a device from before: hidden, not listed.
    const live = trashedElsewhere(b1, ia!, 5);
    const gone = trashBoard(newBoard("other", "Other", 1, uids()), 7);
    const older = trashBoard(newBoard("older", "Older", 1, uids()), 6);
    const entries = trashEntriesOf([live, older, gone]);
    expect(entries.map((entry) => entry.board.uid)).toEqual(["other", "older"]);
    expect(entries[0]).toMatchObject({ deletedAt: 7, itemCount: 0 });
    expect(restoreBoard(gone).deletedAt).toBeNull();
    expect(restoreBoard(live)).toBe(live);
    expect(trashBoard(gone, 9)).toBe(gone);
    // To the trash and back, a list keeps its last edit and so its place in Recent.
    expect(gone.editedAt).toBe(1);
    expect(restoreBoard(gone).editedAt).toBe(1);

    const emptied = withoutTrash([live, gone]);
    expect(emptied.map((b) => b.uid)).toEqual(["board"]);
    expect(emptied[0]?.items.map((item) => item.title)).toEqual(["b"]);
    // Nothing in the trash: the same boards back.
    expect(withoutTrash([b1])[0]).toBe(b1);
  });
});
