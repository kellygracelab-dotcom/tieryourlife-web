import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import {
  copyOfList,
  extraCopies,
  holdsArrangement,
  mineOfCopy,
  rearrangeCopy,
  tidiedKey,
  tidyCopies,
} from "./listCopies";
import { itemsIn, newBoard, poolTier, rankedTiers, type Board } from "./model";
import { boardFromList } from "./publish";
import { boardsRepository } from "./repository";

const list = (id: string): PublishedList => ({
  id,
  title: "Eurovision",
  authorUid: "author",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "music",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 9,
  takeCount: 0,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
  ],
  items: [
    { title: "Ukraine", imageUrl: null, tierIndex: 0 },
    { title: "Sweden", imageUrl: null, tierIndex: 1 },
    { title: "Italy", imageUrl: null, tierIndex: null },
  ],
});

const uids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${n++}`;
};

/** A copy of a list under a given uid, its cards placed as these rows say. */
const copy = (uid: string, of = list("euro"), rows: number[][] | null = null, now = 1): Board => ({
  ...boardFromList(of, rows, now, uids(uid)),
  uid,
});

const titlesIn = (board: Board) => [
  ...rankedTiers(board).map((tier) => itemsIn(board, tier.uid).map((item) => item.title)),
  itemsIn(board, poolTier(board)!.uid).map((item) => item.title),
];

describe("one board per list", () => {
  it("finds the copy kept: out in Rankings first, then the one with more placed, then the uid", () => {
    const bare = copy("b");
    const placed = copy("c", list("euro"), [[0], [1]]);
    expect(copyOfList([bare, placed], "euro")?.uid).toBe("c");
    const out = { ...copy("d"), rankingOf: "euro" };
    expect(copyOfList([bare, placed, out], "euro")?.uid).toBe("d");
    expect(copyOfList([copy("z"), copy("a")], "euro")?.uid).toBe("a");
    // Neither a trashed copy nor another list's, nor the board one's own list went out from.
    expect(copyOfList([{ ...placed, deletedAt: 3 }], "euro")).toBeNull();
    expect(copyOfList([copy("e", list("other"))], "euro")).toBeNull();
    expect(copyOfList([{ ...placed, publishedId: "euro" }], "euro")).toBeNull();
  });

  it("calls every copy but the kept one extra, and never another list, an own board or a list out", () => {
    const keeper = copy("a", list("euro"), [[0]]);
    const twin = copy("b");
    const other = copy("c", list("other"));
    const own = newBoard("own", "Eurovision", 1, uids("own"));
    const published = { ...copy("p"), publishedId: "euro" };
    const third = copy("s");
    const extra = extraCopies([keeper, twin, other, own, published], new Set());
    expect(extra.map((board) => board.uid)).toEqual(["b"]);
    // Two out in Rankings: neither goes, whichever is kept.
    const out = [
      { ...keeper, rankingOf: "euro" },
      { ...twin, rankingOf: "euro" },
    ];
    expect(extraCopies(out, new Set())).toEqual([]);
    // One of them brought back from the trash: two of them is the person's choice.
    expect(extraCopies([keeper, twin, third], new Set(["b"]))).toEqual([]);
  });

  it("puts the extra copies in the trash once, where they can be brought back", () => {
    const store = memoryStore();
    const repository = boardsRepository(memoryStore());
    const keeper = copy("a", list("euro"), [[0], [1]]);
    repository.saveAll([
      keeper,
      copy("b"),
      copy("c"),
      copy("d", list("other")),
      newBoard("own", "Mine", 1, uids("own")),
    ]);
    expect(tidyCopies(repository, store, "me", 50).sort()).toEqual(["b", "c"]);
    expect(repository.get("b")?.deletedAt).toBe(50);
    expect(repository.get("c")?.deletedAt).toBe(50);
    expect(repository.get("a")?.deletedAt).toBeNull();
    expect(repository.get("d")?.deletedAt).toBeNull();
    expect(repository.get("own")?.deletedAt).toBeNull();
    expect(JSON.parse(store.read(tidiedKey("me"))!)).toEqual(expect.arrayContaining(["b", "c"]));
    // Nothing more to do: a second pass moves nothing.
    expect(tidyCopies(repository, store, "me", 60)).toEqual([]);
    // Brought back, a copy stays.
    repository.save({ ...repository.get("b")!, deletedAt: null });
    expect(tidyCopies(repository, store, "me", 70)).toEqual([]);
    expect(repository.get("b")?.deletedAt).toBeNull();
  });

  it("keeps what it tidied apart per account", () => {
    expect(tidiedKey("me")).not.toBe(tidiedKey(null));
    const store = memoryStore();
    store.write(tidiedKey("me"), "not json");
    const repository = boardsRepository(memoryStore());
    repository.saveAll([copy("a", list("euro"), [[0]]), copy("b")]);
    expect(tidyCopies(repository, store, "me", 5)).toEqual(["b"]);
  });
});

describe("a board that lost its tie to the list", () => {
  const pictured: PublishedList = {
    ...list("euro"),
    items: list("euro").items.map((item, i) => ({ ...item, imageUrl: `https://p.test/${i}.webp` })),
  };
  /** The copy's cards as text, the tie to the list gone: an old Publish's board. */
  const textOf = (board: Board, uid: string, editedAt = 1): Board => ({
    ...board,
    uid,
    takenFrom: null,
    origin: undefined,
    editedAt,
    items: board.items.map((item) => ({ ...item, imageUrl: null })),
  });
  const kept = copy("b7ea", pictured, [[0, 1], []]);

  it("is extra beside a copy with the same cards by title in the same tiers, pictures aside", () => {
    const text = textOf(kept, "cf04");
    expect(extraCopies([kept, text], new Set()).map((board) => board.uid)).toEqual(["cf04"]);
    // Showing the copy's own pictures is no difference either.
    expect(extraCopies([kept, { ...text, items: kept.items }], new Set())).toHaveLength(1);
  });

  it("stays at any difference: a card, a tier, a picture of its own, or when brought back", () => {
    const text = textOf(kept, "cf04");
    const [s, a] = rankedTiers(text);
    const moved = {
      ...text,
      items: text.items.map((item) =>
        item.title === "Sweden" ? { ...item, tierUid: a!.uid, position: 0 } : item,
      ),
    };
    const renamedCard = {
      ...text,
      items: text.items.map((item) =>
        item.title === "Ukraine" ? { ...item, title: "Ukraina" } : item,
      ),
    };
    const renamedTier = {
      ...text,
      tiers: text.tiers.map((tier) => (tier.uid === s!.uid ? { ...tier, label: "Top" } : tier)),
    };
    const uploaded = {
      ...text,
      items: text.items.map((item, i) => (i === 0 ? { ...item, pictureId: "up-1" } : item)),
    };
    const elsewhere = {
      ...text,
      items: text.items.map((item, i) =>
        i === 0 ? { ...item, imageUrl: "https://other.test/u.webp" } : item,
      ),
    };
    const ownCover = { ...text, coverImageUrl: "https://other.test/c.webp" };
    for (const board of [moved, renamedCard, renamedTier, uploaded, elsewhere, ownCover]) {
      expect(extraCopies([kept, board], new Set()), board.uid).toEqual([]);
    }
    expect(extraCopies([kept, text], new Set(["cf04"]))).toEqual([]);
    // Published, a ranking of somebody's, or in the trash: none of them is a loose board.
    expect(extraCopies([kept, { ...text, publishedId: "mine" }], new Set())).toEqual([]);
    expect(extraCopies([kept, { ...text, rankingOf: "x" }], new Set())).toEqual([]);
    expect(extraCopies([kept, { ...text, deletedAt: 5 }], new Set())).toEqual([]);
  });

  it("keeps the one edited last of two with no copy, and never empty boards", () => {
    const older = textOf(kept, "old", 1);
    const newer = textOf(kept, "new", 2);
    expect(extraCopies([newer, older], new Set()).map((board) => board.uid)).toEqual(["old"]);
    const empty = (uid: string) => newBoard(uid, "Untitled list", 1, uids(uid));
    expect(extraCopies([empty("u1"), empty("u2")], new Set())).toEqual([]);
  });

  it("goes to the trash with the copies tidied, once", () => {
    const store = memoryStore();
    const repository = boardsRepository(memoryStore());
    repository.saveAll([kept, textOf(kept, "cf04")]);
    expect(tidyCopies(repository, store, "u1", 7)).toEqual(["cf04"]);
    expect(repository.get("cf04")?.deletedAt).toBe(7);
    expect(repository.get("b7ea")?.deletedAt).toBeNull();
  });
});

describe("Mine from the saved board", () => {
  it("reads the list's cards by their place, in the board's tiers, the pool in its order", () => {
    expect(mineOfCopy(copy("c", list("euro"), [[1], [0]]), list("euro"))).toEqual({
      rows: [[1], [0]],
      poolOrder: [2],
    });
  });

  it("gives nothing for a board that places nothing or is no longer the list's", () => {
    expect(mineOfCopy(copy("c"), list("euro"))).toBeNull();
    const board = copy("c", list("euro"), [[1], [0]]);
    expect(mineOfCopy({ ...board, title: "Mine now" }, list("euro"))).toBeNull();
  });
});

describe("saving over the copy", () => {
  it("says whether the copy holds an arrangement, and puts another on it", () => {
    const of = list("euro");
    const board = copy("a", of, [[0], [1]]);
    expect(holdsArrangement(board, of, [[0], [1]])).toBe(true);
    expect(holdsArrangement(board, of, [[1], [0]])).toBe(false);
    expect(holdsArrangement(copy("b", of), of, null)).toBe(true);
    const moved = rearrangeCopy(board, of, [[2, 1], []], 9)!;
    expect(moved.uid).toBe("a");
    expect(titlesIn(moved)).toEqual([["Italy", "Sweden"], [], ["Ukraine"]]);
    expect(holdsArrangement(moved, of, [[2, 1], []])).toBe(true);
  });

  it("leaves a copy that is no longer the list's alone", () => {
    const of = list("euro");
    const board = copy("a", of, [[0]]);
    const renamed = { ...board, tiers: board.tiers.map((tier) => ({ ...tier, label: "X" })) };
    expect(holdsArrangement(renamed, of, [[1]])).toBe(true);
    expect(rearrangeCopy(renamed, of, [[1]], 9)).toBeNull();
  });
});
