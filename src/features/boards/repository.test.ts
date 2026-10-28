import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "../../lib/storage";
import { newBoard, poolTier } from "./model";
import { boardKey, boardsRepository, parseBoard } from "./repository";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

describe("parseBoard", () => {
  it("reads an anonymous board from the account, and takes anything but true for no", () => {
    const board = newBoard("b1", "Films", 1, () => "t");
    expect(parseBoard({ ...board, anonymous: true })?.anonymous).toBe(true);
    expect(parseBoard({ ...board, anonymous: "yes" })?.anonymous).toBe(false);
    const { anonymous: _left, ...without } = board;
    expect(parseBoard(without)?.anonymous).toBe(false);
  });

  it("reads back what was written, whole", () => {
    const board = newBoard("b1", "Films", 5, uids());
    expect(parseBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });

  it("takes a board the account kept: no local fields, cards by tier uid", () => {
    const kept = {
      uid: "b1",
      title: "Films",
      displayMode: "HORIZONTAL_SCROLL",
      category: "film_tv",
      coverImageUrl: null,
      coverImageUrls: ["https://x/1.jpg"],
      authorName: "danylo",
      publishedId: "p1",
      deletedAt: null,
      tiers: [
        {
          uid: "t1",
          position: 0,
          label: "S",
          caption: null,
          colorLight: "#b03a32",
          colorDark: "#f1948c",
          isPool: false,
        },
        {
          uid: "pool",
          position: 1,
          label: "",
          caption: null,
          colorLight: "#dad7e0",
          colorDark: "#46464f",
          isPool: true,
        },
      ],
      items: [
        {
          uid: "i1",
          pictureId: "pic",
          tierUid: "t1",
          position: 0,
          title: "Dune",
          imageUrl: null,
          source: "TMDB",
          deletedAt: null,
        },
        {
          uid: "i2",
          pictureId: null,
          tierUid: "gone",
          position: 0,
          title: "Lost",
          imageUrl: null,
          source: "MANUAL",
          deletedAt: null,
        },
      ],
    };
    const board = parseBoard(kept);
    expect(board).toMatchObject({
      uid: "b1",
      displayMode: "HORIZONTAL_SCROLL",
      category: "film_tv",
      publishedId: "p1",
      editedAt: 0,
      favouritedAt: null,
      arrivedFrom: null,
    });
    // A card naming a tier that is not there is dropped, not guessed at.
    expect(board?.items.map((item) => item.uid)).toEqual(["i1"]);
    expect(board?.items[0]?.pictureId).toBe("pic");
  });

  it("gives a board without a pool one, and refuses what is not a board", () => {
    const board = parseBoard({
      uid: "b1",
      title: "x",
      tiers: [{ uid: "t1", label: "S", colorLight: "#000000", colorDark: "#ffffff" }],
    });
    expect(poolTier(board!)?.isPool).toBe(true);
    expect(board?.tiers[0]?.position).toBe(0);
    expect(board?.category).toBeNull();
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard({ title: "no uid", tiers: [] })).toBeNull();
    expect(parseBoard({ uid: "b", tiers: [] })).toBeNull();
    expect(parseBoard({ uid: "b", tiers: [{ label: "no uid" }] })).toBeNull();
    expect(
      parseBoard({ uid: "b", title: "x", tiers: [{ uid: "t", colorLight: "red" }] })?.tiers[0]
        ?.colorLight,
    ).toBe("#DAD7E0");
  });

  it("keeps a section's id it does not know, rather than unfiling the list", () => {
    const categoryOf = (category: unknown) =>
      parseBoard({ uid: "b", category, tiers: [{ uid: "t", label: "S" }] })?.category;
    expect(categoryOf("street-food")).toBe("street-food");
    expect(categoryOf("s-k3j9x2ab")).toBe("s-k3j9x2ab");
    expect(categoryOf("film_tv")).toBe("film_tv");
    expect(categoryOf("")).toBeNull();
    expect(categoryOf(7)).toBeNull();
  });

  it("reads the display mode by the phone's names, and this site's old name for the ranked column", () => {
    const modeOf = (displayMode: unknown) =>
      parseBoard({ uid: "b", displayMode, tiers: [{ uid: "t", label: "S" }] })?.displayMode;
    expect(modeOf("WRAP")).toBe("WRAP");
    expect(modeOf("HORIZONTAL_SCROLL")).toBe("HORIZONTAL_SCROLL");
    expect(modeOf("FLAT_RANKED")).toBe("FLAT_RANKED");
    expect(modeOf("RANKED")).toBe("FLAT_RANKED");
    expect(modeOf("SIDEWAYS")).toBe("WRAP");
    expect(modeOf(undefined)).toBe("WRAP");
  });

  it("keeps this device's topic, and drops one it cannot read", () => {
    const topicOf = (topic: unknown) =>
      parseBoard({ uid: "b", topic, tiers: [{ uid: "t", label: "S" }] })?.topic;
    expect(topicOf({ id: "t1", name: "Pokémon" })).toEqual({ id: "t1", name: "Pokémon" });
    expect(topicOf({ id: "", name: "Pokémon" })).toBeNull();
    expect(topicOf({ id: "t1" })).toBeNull();
    expect(topicOf("t1")).toBeNull();
    expect(topicOf(undefined)).toBeNull();
  });
});

describe("the repository", () => {
  it("keeps one key per board, hands back the same array until something changes, and tells its listeners", () => {
    const store = memoryStore();
    const repo = boardsRepository(store);
    const listener = vi.fn();
    repo.subscribe(listener);
    expect(repo.all()).toEqual([]);
    const first = repo.all();
    expect(repo.all()).toBe(first);

    const a = newBoard("a", "A", 1, uids());
    repo.save(a);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read(boardKey("a"))).toContain('"title":"A"');
    expect(repo.all()).toEqual([a]);
    expect(repo.get("a")).toEqual(a);
    expect(repo.get("b")).toBeNull();

    repo.saveAll([newBoard("b", "B", 2, uids()), { ...a, title: "A2" }]);
    expect(
      repo
        .all()
        .map((board) => board.title)
        .sort(),
    ).toEqual(["A2", "B"]);
    repo.remove("a");
    expect(repo.all().map((board) => board.uid)).toEqual(["b"]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("leaves a key it cannot read alone, and other keys of the site untouched", () => {
    const store = memoryStore();
    store.write(boardKey("broken"), "{not json");
    store.write(boardKey("empty"), JSON.stringify({ uid: "empty", tiers: [] }));
    store.write("tyl:locale", "uk");
    const repo = boardsRepository(store);
    expect(repo.all()).toEqual([]);
    expect(store.read(boardKey("broken"))).toBe("{not json");
    expect(store.read("tyl:locale")).toBe("uk");
  });

  it("hears another tab writing a board", () => {
    const store = memoryStore();
    const repo = boardsRepository(store);
    const listener = vi.fn();
    const stop = repo.subscribe(listener);
    const before = repo.all();
    store.write(boardKey("x"), JSON.stringify(newBoard("x", "X", 1, uids())));
    // Not seen yet: the store said nothing.
    expect(repo.all()).toBe(before);
    window.dispatchEvent(new StorageEvent("storage", { key: boardKey("x") }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.all().map((board) => board.uid)).toEqual(["x"]);
    window.dispatchEvent(new StorageEvent("storage", { key: "tyl:locale" }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: boardKey("x") }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
