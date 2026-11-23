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

/** The copy's name the backend gives a picture from this address (Proxy, outsideName). */
const copyName = async (url: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `w-${hex.join("").slice(0, 32)}`;
};

const storage = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tyl/o/${encodeURIComponent(path)}?alt=media`;

/** The list as a publish of the board would have made it: each picture as the list's copy of it. */
const published = async (b: Board): Promise<PublishedList> => {
  const request = publishRequestOf(b)!;
  const items = await Promise.all(
    request.items.map(async (item) => ({
      title: item.title,
      imageUrl:
        item.pictureId !== null
          ? storage(`published/L1/${item.pictureId}`)
          : item.imageUrl === null
            ? null
            : storage(`published/L1/${await copyName(item.imageUrl)}_p_3250b2c8`),
      tierIndex: item.tierIndex,
    })),
  );
  return {
    title: request.title,
    category: request.category,
    coverImageUrl: null,
    tiers: request.tiers,
    items,
  } as unknown as PublishedList;
};

describe("sameAsPublished", () => {
  const out = (): Board => ({ ...board(), category: "film_tv" });
  const withPictures = (
    b: Board,
    at: (title: string) => Partial<Board["items"][number]>,
  ): Board => ({
    ...b,
    items: b.items.map((item) => ({ ...item, ...at(item.title) })),
  });

  it("says so when the list shows the board, its pictures by their source", async () => {
    const b = out();
    expect(await sameAsPublished(b, await published(b))).toBe(true);
    const pictured = withPictures(b, (title) => ({ imageUrl: `https://elsewhere/${title}.jpg` }));
    expect(await sameAsPublished(pictured, await published(pictured))).toBe(true);
    // A catalogue's copy on the board, the list's own copy of it under the same name.
    const catalogue = withPictures(b, (title) => ({
      imageUrl: storage(`published/catalogue/w-${"0".repeat(31)}${title.length}`),
    }));
    const list = await published(catalogue);
    const copied = {
      ...list,
      items: list.items.map((item, at) => ({
        ...item,
        imageUrl: storage(
          `published/L1/catalogue-w-${"0".repeat(31)}${request(catalogue)[at]!.title.length}_p_9`,
        ),
      })),
    };
    expect(await sameAsPublished(catalogue, copied)).toBe(true);
    // One's own photo, the list's copy named by its id.
    const own = withPictures(b, (title) => ({
      imageUrl: `blob:${title}`,
      pictureId: `pic-${title}`,
    }));
    expect(await sameAsPublished(own, await published(own))).toBe(true);
  });

  it("does not when only a picture was replaced, on this device or another", async () => {
    const pictured = withPictures(out(), (title) => ({
      imageUrl: `https://elsewhere/${title}.jpg`,
    }));
    const list = await published(pictured);
    const replaced = withPictures(pictured, (title) =>
      title === "Heat" ? { imageUrl: "https://elsewhere/heat-poster-2.jpg" } : {},
    );
    expect(await sameAsPublished(replaced, list)).toBe(false);
    const own = withPictures(pictured, (title) =>
      title === "Heat" ? { imageUrl: "blob:x", pictureId: "pic-new" } : {},
    );
    expect(await sameAsPublished(own, list)).toBe(false);
    const taken = withPictures(pictured, (title) => (title === "Heat" ? { imageUrl: null } : {}));
    expect(await sameAsPublished(taken, list)).toBe(false);
  });

  it("does not when the list's picture names no source it can be told by", async () => {
    const pictured = withPictures(out(), (title) => ({
      imageUrl: `https://elsewhere/${title}.jpg`,
    }));
    const list = await published(pictured);
    const unnamed = {
      ...list,
      items: list.items.map((item) => ({
        ...item,
        imageUrl: storage("published/L1/picture.webp"),
      })),
    };
    expect(await sameAsPublished(pictured, unnamed)).toBe(false);
  });

  it("does not for a new name, a card moved or reordered, or a tier renamed", async () => {
    const b = out();
    const list = await published(b);
    expect(await sameAsPublished(rename(b, "Films I love", 5), list)).toBe(false);
    const [dune, heat] = liveItems(b);
    const s = rankedTiers(b)[0]!.uid;
    const a = rankedTiers(b)[1]!.uid;
    expect(await sameAsPublished(moveItem(b, dune!.uid, a, 0, 5), list)).toBe(false);
    expect(await sameAsPublished(moveItem(b, heat!.uid, s, 0, 5), list)).toBe(false);
    const relabelled = {
      ...b,
      tiers: b.tiers.map((tier) => (tier.uid === s ? { ...tier, label: "Best" } : tier)),
    };
    expect(await sameAsPublished(relabelled, list)).toBe(false);
  });
});

const request = (b: Board) => publishRequestOf(b)!.items;
