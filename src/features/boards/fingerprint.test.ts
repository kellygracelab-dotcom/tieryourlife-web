import { describe, expect, it } from "vitest";
import { fingerprintOf, fingerprintText } from "./fingerprint";
import type { Board } from "./model";

const board = (over: Partial<Board> = {}): Board => ({
  uid: "board-1",
  title: "Sci-fi films",
  displayMode: "WRAP",
  category: null,
  coverImageUrl: null,
  coverImageUrls: [],
  authorName: null,
  publishedId: null,
  deletedAt: null,
  tiers: [
    {
      uid: "tier-s",
      position: 0,
      label: "S",
      caption: "Masterpiece",
      colorLight: "#B03A32",
      colorDark: "#F1948C",
      isPool: false,
    },
    {
      uid: "tier-pool",
      position: 1,
      label: "Unranked",
      caption: null,
      colorLight: "#3A3A3A",
      colorDark: "#CFCFCF",
      isPool: true,
    },
  ],
  items: [
    {
      uid: "item-1",
      pictureId: null,
      tierUid: "tier-s",
      position: 0,
      title: "Arrival",
      imageUrl: null,
      source: "MANUAL",
      deletedAt: null,
    },
    {
      uid: "item-2",
      pictureId: null,
      tierUid: "tier-s",
      position: 1,
      title: "Dune",
      imageUrl: null,
      source: "MANUAL",
      deletedAt: null,
    },
  ],
  editedAt: 5,
  favouritedAt: null,
  arrivedFrom: null,
  publishedEditedAt: null,
  ...over,
});

describe("the fingerprint", () => {
  // Both digests were worked out apart from this code, with the phone's rules
  // (length-prefixed fields, tiers and cards by uid, "~|" for nothing).
  it("hashes the way the phone does", async () => {
    expect(await fingerprintOf(board())).toBe(
      "0b16834695e174e611125c65f03e0a0c4e819defecffd1a2124cd7964e0a96d5",
    );
    const other = board({
      uid: "b",
      title: "Фильмы",
      displayMode: "RANKED",
      category: "film_tv",
      coverImageUrl: "https://x/c.jpg",
      coverImageUrls: ["https://x/1.jpg", "https://x/2.jpg"],
      authorName: "danylo",
      publishedId: "ignored",
      deletedAt: 1700000000000,
      tiers: [
        {
          uid: "t2",
          position: 1,
          label: "",
          caption: null,
          colorLight: "#DAD7E0",
          colorDark: "#46464F",
          isPool: true,
        },
        {
          uid: "t1",
          position: 0,
          label: "S",
          caption: "лучшие",
          colorLight: "#B03A32",
          colorDark: "#F1948C",
          isPool: false,
        },
      ],
      items: [
        {
          uid: "i2",
          pictureId: null,
          tierUid: "t1",
          position: 1,
          title: "Heat",
          imageUrl: "https://x/h.jpg",
          source: "MANUAL",
          deletedAt: 1700000000001,
        },
        {
          uid: "i1",
          pictureId: "pic-1",
          tierUid: "t1",
          position: 0,
          title: "Dune",
          imageUrl: "blob:local",
          source: "TMDB",
          deletedAt: null,
        },
      ],
    });
    expect(await fingerprintOf(other)).toBe(
      "04b1ffcf0c9415177df7b1b8626794afb354a979a5ab722bc9c02cdbd6915746",
    );
  });

  it("ignores what is this device's own, and the published id", () => {
    const a = fingerprintText(board());
    expect(fingerprintText(board({ editedAt: 99, favouritedAt: 1, arrivedFrom: "x" }))).toBe(a);
    expect(fingerprintText(board({ publishedId: "p1" }))).toBe(a);
  });

  it("changes with what matters: a name, a move, a colour, a card in the trash, a collage", () => {
    const a = fingerprintText(board());
    expect(fingerprintText(board({ title: "Films" }))).not.toBe(a);
    const swapped = board();
    swapped.items = swapped.items.map((item) => ({ ...item, position: 1 - item.position }));
    expect(fingerprintText(swapped)).not.toBe(a);
    const recoloured = board();
    recoloured.tiers = recoloured.tiers.map((tier) => ({ ...tier, colorLight: "#000000" }));
    expect(fingerprintText(recoloured)).not.toBe(a);
    const trashed = board();
    trashed.items = trashed.items.map((item, i) => (i === 0 ? { ...item, deletedAt: 7 } : item));
    expect(fingerprintText(trashed)).not.toBe(a);
    expect(fingerprintText(board({ coverImageUrls: ["a", "b"] }))).not.toBe(a);
    // One picture alone is no collage: the phone keeps nothing for it.
    expect(fingerprintText(board({ coverImageUrls: ["a"] }))).toBe(a);
  });

  it("reads the same whatever order the rows come in", () => {
    const a = board();
    const shuffled = board({ tiers: [...a.tiers].reverse(), items: [...a.items].reverse() });
    expect(fingerprintText(shuffled)).toBe(fingerprintText(a));
  });
});
