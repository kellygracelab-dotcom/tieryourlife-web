import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import {
  boardFromHouseList,
  hasUnsentEdits,
  HOUSE_BOARDS_KEY,
  houseBoardPath,
  houseLinkOf,
  houseLinkOfParam,
  houseRequestOf,
  linkToHouse,
  markHouseSent,
  NEW_HOUSE_PATH,
  unlinkFromHouse,
} from "./houseList";
import {
  addToPool,
  coverCreditOf,
  itemsIn,
  newBoard,
  poolTier,
  rankedTiers,
  setCardCredit,
  setCategory,
  setCover,
  setCoverCredit,
} from "./model";
import { parseBoard } from "./repository";
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

  it("knows which edits a house board has not sent, by this device's clock alone", () => {
    const store = memoryStore();
    const board = { ...newBoard("b1", "Ramen", 10, uids()), editedAt: 10 };
    // Never marked: taken to hold edits, so nothing is dropped unasked.
    expect(hasUnsentEdits(board, store)).toBe(true);
    markHouseSent("b1", 10, store);
    expect(hasUnsentEdits(board, store)).toBe(false);
    expect(hasUnsentEdits({ ...board, editedAt: 11 }, store)).toBe(true);
    linkToHouse("b1", "h1", store);
    unlinkFromHouse("b1", store);
    expect(hasUnsentEdits(board, store)).toBe(true);
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

describe("the editor's credits on a house board", () => {
  const COMMONS = "https://commons.wikimedia.org/wiki/File:Ramen.jpg";
  const credit = { author: "Jane", license: "CC BY 4.0", link: COMMONS };
  const board = () => {
    const next = uids();
    const filed = setCategory(newBoard("b1", "Ramen", 1, next), "food", 1);
    return addToPool(
      filed,
      [
        {
          title: "Shoyu",
          imageUrl: POSTER,
          attribution: { source: "tmdb", id: "tmdb:movie:1", license: "x" },
        },
        { title: "Mine", imageUrl: "https://example.com/mine.jpg", pictureId: "own1" },
        { title: "Miso", imageUrl: null },
      ],
      1,
      next,
    );
  };
  const uidOf = (b: ReturnType<typeof board>, title: string) =>
    b.items.find((item) => item.title === title)!.uid;

  it("sends a card's credit on its attribution, marked manual, keeping its source and id", () => {
    const b = board();
    const credited = setCardCredit(
      setCardCredit(b, uidOf(b, "Shoyu"), credit, 2),
      uidOf(b, "Mine"),
      { license: "Used with permission", link: "https://site.test/p" },
      3,
    );
    const items = houseRequestOf(credited, "h1")!.items;
    expect(items[0]!.attribution).toEqual({
      source: "tmdb",
      id: "tmdb:movie:1",
      manual: true,
      author: "Jane",
      license: "CC BY 4.0",
      link: COMMONS,
    });
    // An uploaded picture is "web".
    expect(items[1]!.attribution).toEqual({
      source: "web",
      manual: true,
      license: "Used with permission",
      link: "https://site.test/p",
    });
    // A card with no picture has nothing to credit.
    expect(setCardCredit(credited, uidOf(b, "Miso"), credit, 4)).toBe(credited);
  });

  it("takes a card's credit off with manual false, keeping its page", () => {
    const b = board();
    const credited = setCardCredit(b, uidOf(b, "Shoyu"), credit, 2);
    const removed = setCardCredit(credited, uidOf(b, "Shoyu"), null, 3);
    expect(houseRequestOf(removed, "h1")!.items[0]!.attribution).toEqual({
      source: "tmdb",
      id: "tmdb:movie:1",
      link: COMMONS,
      manual: false,
    });
    // Nothing to take off: the board stays as it is.
    expect(setCardCredit(b, uidOf(b, "Shoyu"), null, 3)).toBe(b);
  });

  it("sends the cover's credit, null once it is taken off, and nothing while untouched", () => {
    const covered = setCover(board(), [POSTER], 2);
    expect(houseRequestOf(covered, "h1")).not.toHaveProperty("coverAttribution");
    const credited = setCoverCredit(covered, credit, 3);
    expect(houseRequestOf(credited, "h1")!.coverAttribution).toEqual({ manual: true, ...credit });
    expect(houseRequestOf(credited, null)!.coverAttribution).toEqual({ manual: true, ...credit });
    expect(houseRequestOf(setCoverCredit(credited, null, 4), "h1")!.coverAttribution).toBeNull();
  });

  it("drops the cover's credit when the cover changes, and gives none to a collage", () => {
    const b = board();
    const credited = setCoverCredit(setCover(b, [POSTER], 2), credit, 3);
    const other = setCover(credited, ["https://example.com/mine.jpg"], 4);
    expect(other.coverCredit).toBeUndefined();
    expect(houseRequestOf(other, "h1")).not.toHaveProperty("coverAttribution");
    // The same cover kept keeps it; one taken off and chosen again has none.
    expect(setCover(credited, [POSTER], 4).coverCredit).toEqual({ url: POSTER, credit });
    expect(setCover(setCover(credited, [], 4), [POSTER], 5).coverCredit).toBeUndefined();
    const collage = setCover(b, [POSTER, "https://example.com/mine.jpg"], 2);
    expect(setCoverCredit(collage, credit, 3)).toBe(collage);
    expect(coverCreditOf(collage)).toBeUndefined();
  });

  it("keeps the cover's credit on a board kept on this device", () => {
    const credited = setCoverCredit(setCover(board(), [POSTER], 2), credit, 3);
    const removed = setCoverCredit(credited, null, 4);
    expect(parseBoard(JSON.parse(JSON.stringify(credited)))?.coverCredit).toEqual({
      url: POSTER,
      credit,
    });
    expect(parseBoard(JSON.parse(JSON.stringify(removed)))?.coverCredit).toEqual({
      url: POSTER,
      credit: null,
    });
    expect(
      parseBoard({ ...JSON.parse(JSON.stringify(credited)), coverCredit: { url: POSTER } }),
    ).not.toHaveProperty("coverCredit");
  });

  it("opens a house list with its cover and the cover's credit, and its cards' credits", () => {
    const list: PublishedList = {
      ...houseList,
      coverImageUrl: POSTER,
      coverAttribution: credit,
      items: [
        {
          title: "Shoyu",
          imageUrl: POSTER,
          tierIndex: 0,
          attribution: { source: "tmdb", manual: true, ...credit },
        },
      ],
    };
    const b = boardFromHouseList(list, 5, uids());
    expect(b.coverImageUrls).toEqual([POSTER]);
    expect(b.coverCredit).toEqual({ url: POSTER, credit });
    const request = houseRequestOf(b, "h1")!;
    expect(request.coverImageUrl).toBe(POSTER);
    // Sent back as stored: the server keeps it without reading it again.
    expect(request.coverAttribution).toEqual({ manual: true, ...credit });
    expect(request.items[0]!.attribution).toEqual({ source: "tmdb", manual: true, ...credit });
    expect(boardFromHouseList(houseList, 5, uids())).not.toHaveProperty("coverCredit");
    expect(boardFromHouseList(houseList, 5, uids()).coverImageUrls).toEqual([]);
  });
});
