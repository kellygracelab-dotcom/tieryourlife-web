import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import {
  boardFromHouseList,
  HOUSE_BOARDS_KEY,
  houseBoardPath,
  houseLinkOf,
  houseLinkOfParam,
  houseRequestOf,
  linkToHouse,
  NEW_HOUSE_PATH,
} from "./houseList";
import { addToPool, itemsIn, newBoard, poolTier, rankedTiers, setCategory } from "./model";
import { publishRequestOf } from "./publish";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

/** The feed's own copy of a picture of list `listId`. */
const feedCopy = (listId: string, pictureId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(`published/${listId}/${pictureId}`)}?alt=media`;
const POSTER = "https://image.tmdb.org/t/p/w500/witch.jpg";

const houseList: PublishedList = {
  id: "h1",
  title: "Best ramen",
  anonymous: true,
  authorUid: "",
  authorName: "",
  authorPhotoUrl: null,
  category: "food",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  topicId: "t1",
  topicName: "Ramen",
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: "good", colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Tonkotsu", imageUrl: feedCopy("h1", "p1"), tierIndex: 0 },
    { title: "Shoyu", imageUrl: POSTER, tierIndex: 1 },
    { title: "Miso", imageUrl: null, tierIndex: null },
  ],
};

describe("the boards this device edits for the house", () => {
  it("remembers a board as the house's, with the list it updates or none yet", () => {
    const store = memoryStore();
    expect(houseLinkOf("b1", store)).toBeNull();
    linkToHouse("b1", null, store);
    linkToHouse("b2", "h1", store);
    expect(houseLinkOf("b1", store)).toEqual({ listId: null });
    expect(houseLinkOf("b2", store)).toEqual({ listId: "h1" });
    linkToHouse("b1", "h2", store);
    expect(houseLinkOf("b1", store)).toEqual({ listId: "h2" });
    expect(houseLinkOf("b3", store)).toBeNull();
  });

  it("reads nothing from a stored value that is not its own shape", () => {
    const store = memoryStore();
    for (const raw of ["{", "null", "[1]", '"b1"']) {
      store.write(HOUSE_BOARDS_KEY, raw);
      expect(houseLinkOf("b1", store)).toBeNull();
    }
    store.write(HOUSE_BOARDS_KEY, JSON.stringify({ b1: 4, b2: "h1" }));
    expect(houseLinkOf("b1", store)).toBeNull();
    expect(houseLinkOf("b2", store)).toEqual({ listId: "h1" });
  });

  it("reads the address: new, a list's id, or nothing of the house", () => {
    expect(houseLinkOfParam("new")).toEqual({ listId: null });
    expect(houseLinkOfParam("h1")).toEqual({ listId: "h1" });
    expect(houseLinkOfParam("")).toBeNull();
    expect(houseLinkOfParam(null)).toBeNull();
    expect(NEW_HOUSE_PATH).toBe("/b/new?house=new");
    expect(houseBoardPath("b 1", null)).toBe("/b/b%201?house=new");
    expect(houseBoardPath("b1", "h/1")).toBe("/b/b1?house=h%2F1");
  });
});

describe("houseRequestOf", () => {
  const board = () => {
    const next = uids();
    const filed = setCategory(newBoard("b1", "Ramen", 1, next), "food", 1);
    return addToPool(
      filed,
      [
        { title: "Tonkotsu", imageUrl: feedCopy("h1", "p1") },
        { title: "Shoyu", imageUrl: POSTER },
        { title: "Mine", imageUrl: "https://example.com/mine.jpg", pictureId: "own1" },
        { title: "Elsewhere", imageUrl: feedCopy("other", "p9") },
      ],
      1,
      next,
    );
  };

  it("is the board's own request for a list going out the first time", () => {
    expect(houseRequestOf(board(), null)).toEqual(publishRequestOf(board()));
  });

  it("names the list's own copies by id when it replaces that list, and nothing else", () => {
    const request = houseRequestOf(board(), "h1");
    expect(request?.items.map(({ imageUrl, pictureId }) => ({ imageUrl, pictureId }))).toEqual([
      { imageUrl: null, pictureId: "p1" },
      { imageUrl: POSTER, pictureId: null },
      { imageUrl: null, pictureId: "own1" },
      { imageUrl: feedCopy("other", "p9"), pictureId: null },
    ]);
  });

  it("is null while the board could not go out", () => {
    expect(houseRequestOf(newBoard("b2", "Empty", 1, uids()), "h1")).toBeNull();
  });
});

describe("boardFromHouseList", () => {
  it("makes a board of the list as it stands, in its section and topic, with nobody's name", () => {
    const board = boardFromHouseList(houseList, 5, uids());
    expect(board).toMatchObject({
      title: "Best ramen",
      category: "food",
      topic: { id: "t1", name: "Ramen" },
      authorName: null,
      publishedId: null,
      editedAt: 5,
    });
    const tiers = rankedTiers(board);
    expect(tiers.map((tier) => tier.label)).toEqual(["S", "A"]);
    expect(itemsIn(board, tiers[0]!.uid).map((item) => item.title)).toEqual(["Tonkotsu"]);
    expect(itemsIn(board, tiers[1]!.uid).map((item) => item.title)).toEqual(["Shoyu"]);
    expect(itemsIn(board, poolTier(board)!.uid).map((item) => item.title)).toEqual(["Miso"]);
  });

  it("leaves a list without a topic, or from before arrangements travelled, in the pool", () => {
    const old: PublishedList = {
      ...houseList,
      topicId: null,
      items: houseList.items.map(({ title, imageUrl }) => ({ title, imageUrl })),
    };
    const board = boardFromHouseList(old, 5, uids());
    expect(board.topic).toBeNull();
    expect(itemsIn(board, poolTier(board)!.uid)).toHaveLength(3);
    expect(boardFromHouseList({ ...houseList, topicId: undefined }, 5, uids()).topic).toBeNull();
    expect(boardFromHouseList({ ...houseList, topicName: null }, 5, uids()).topic).toEqual({
      id: "t1",
      name: "",
    });
  });
});
