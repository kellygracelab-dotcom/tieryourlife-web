import { describe, expect, it } from "vitest";
import { canonicalPlay, fingerprintOf, fingerprintText } from "./fingerprint";
import { playOf } from "./repository";
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
  topic: null,
  anonymous: false,
  play: null,
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
      displayMode: "FLAT_RANKED",
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
      "24bcee869dde251d21764fb7e73870c7912a17c80982fc8bf03269178fb2e2f2",
    );
  });

  it("ignores what is this device's own, and the published id", () => {
    const a = fingerprintText(board());
    expect(
      fingerprintText(
        board({ editedAt: 99, favouritedAt: 1, arrivedFrom: "x", topic: { id: "t", name: "T" } }),
      ),
    ).toBe(a);
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

  it("is unchanged for a board that is not anonymous, and says anonymous last when it is", () => {
    const plain = fingerprintText(board());
    expect(fingerprintText(board({ anonymous: false }))).toBe(plain);
    const anonymous = fingerprintText(board({ anonymous: true }));
    expect(anonymous.startsWith(plain)).toBe(true);
    expect(anonymous).not.toBe(plain);
  });

  it("writes the anonymous field in the phone's bytes, after everything else", () => {
    // The vector agreed with the app: a board with no tiers, its other fields absent or empty.
    expect(
      fingerprintText(
        board({
          uid: "u",
          title: "T",
          displayMode: "WRAP",
          tiers: [],
          items: [],
          anonymous: true,
        }),
      ),
    ).toBe("1:u|1:T|4:WRAP|~|~|~|~|~|9:anonymous|");
  });

  it("carries a game in progress last, as the canonical JSON the app writes (the proxy's shared example)", () => {
    const example =
      '{"kind":"swiss","count":4,"seed":7,"refine":false,"ids":["a","b","c","d"],' +
      '"history":[[0,1,0],[2,3,null]],"round":1,"startedAt":1793146000000,"scope":["t-s"],"keepTier":true}';
    const play = playOf(JSON.parse(example));
    expect(play).not.toBeNull();
    expect(canonicalPlay(play!)).toBe(example);
    expect(
      fingerprintText(
        board({
          uid: "u",
          title: "T",
          displayMode: "WRAP",
          tiers: [],
          items: [],
          anonymous: true,
          play,
        }),
      ),
    ).toBe(`1:u|1:T|4:WRAP|~|~|~|~|~|9:anonymous|${example.length}:${example}|`);
  });

  it("writes a game in its normal form: no empty scope, keepTier only when true with one tier", () => {
    const base = {
      kind: "hill",
      count: 2,
      seed: 1,
      refine: false,
      ids: ["a", "b"],
      history: [],
      round: 0,
      startedAt: 5,
    };
    expect(canonicalPlay(playOf({ ...base, scope: [], keepTier: false })!)).toBe(
      '{"kind":"hill","count":2,"seed":1,"refine":false,"ids":["a","b"],"history":[],"round":0,"startedAt":5}',
    );
    expect(playOf({ ...base, scope: ["s", "a"], keepTier: true })?.keepTier).toBeUndefined();
    expect(playOf({ ...base, ids: ["a"] })).toBeNull();
    expect(playOf({ ...base, history: [[0, 2, 0]] })).toBeNull();
  });

  it("hashes the three shared boards to the app's own SHA-256", async () => {
    const example =
      '{"kind":"swiss","count":4,"seed":7,"refine":false,"ids":["a","b","c","d"],' +
      '"history":[[0,1,0],[2,3,null]],"round":1,"startedAt":1793146000000,"scope":["t-s"],"keepTier":true}';
    const shared = { uid: "u", title: "T", displayMode: "WRAP" as const, tiers: [], items: [] };
    expect(await fingerprintOf(board(shared))).toBe(
      "8e5ded7251916b6817519d19b768e298cb2e38b195ef08173f4e22c50189b27f",
    );
    expect(await fingerprintOf(board({ ...shared, anonymous: true }))).toBe(
      "b7c68568ab4c48be25a724e26ef8f14ac5f940178b556a1cb4afb7183c717394",
    );
    expect(
      await fingerprintOf(board({ ...shared, anonymous: true, play: playOf(JSON.parse(example)) })),
    ).toBe("b97bfcf2595276d8399cacd16b85ec5341c62ae5ea9916330b394bf61c9cea89");
  });
});
