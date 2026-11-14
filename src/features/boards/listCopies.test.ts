import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import {
  copyOfList,
  extraCopies,
  holdsArrangement,
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
