import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import {
  addToPool,
  arrangeItems,
  itemsIn,
  liveItems,
  newBoard,
  poolTier,
  rankedTiers,
  type Board,
} from "./model";
import { boardFromList, publishProblemsOf, publishRequestOf } from "./publish";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

describe("publishing a board", () => {
  it("names what stands in the way, then builds the snapshot the phone sends", () => {
    const next = uids();
    let b = newBoard("b", "Films", 1, next);
    expect(publishProblemsOf(b)).toEqual(["category", "noItems"]);
    expect(publishRequestOf(b)).toBeNull();
    b = { ...b, category: "film_tv" };
    b = addToPool(
      b,
      [
        { title: "Dune", imageUrl: "https://x/d.jpg", source: "TMDB" },
        { title: "Mine", imageUrl: "https://private/p.jpg", pictureId: "pic-1" },
        { title: "Heat", imageUrl: null },
      ],
      2,
      next,
    );
    const [dune, mine] = liveItems(b).map((item) => item.uid);
    b = arrangeItems(b, [[mine!], [dune!], [], [], []], 3);
    expect(publishProblemsOf(b)).toEqual([]);
    const request = publishRequestOf(b)!;
    expect(request.title).toBe("Films");
    expect(request.category).toBe("film_tv");
    expect(request.tiers.map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D"]);
    // Ranked first in tier order, then the pool; an own picture by id, never by its private address.
    expect(request.items).toEqual([
      { title: "Mine", imageUrl: null, pictureId: "pic-1", tierIndex: 0 },
      { title: "Dune", imageUrl: "https://x/d.jpg", pictureId: null, tierIndex: 1 },
      { title: "Heat", imageUrl: null, pictureId: null, tierIndex: null },
    ]);
    expect(request.coverImageUrls).toEqual([]);
    expect(request.coverImageUrl).toBeNull();
    // No topic is said out loud: a republish with it takes the list out of its old one.
    expect(request.topicId).toBeNull();
    expect(request.noTopic).toBe(true);
    const topical = publishRequestOf({ ...b, topic: { id: "t1", name: "A24" } });
    expect(topical?.topicId).toBe("t1");
    expect(topical?.noTopic).toBeUndefined();
    // Anonymity is said every time too, or a republish would put the name back.
    expect(request.anonymous).toBe(false);
    expect(publishRequestOf({ ...b, anonymous: true })?.anonymous).toBe(true);
  });

  it("sends any section's id: a new one, or one of the person's own still waiting", () => {
    const next = uids();
    const b = addToPool(
      newBoard("b", "Stalls", 1, next),
      [{ title: "a", imageUrl: null }],
      2,
      next,
    );
    expect(publishRequestOf({ ...b, category: "street-food" })?.category).toBe("street-food");
    expect(publishRequestOf({ ...b, category: "s-k3j9x2ab" })?.category).toBe("s-k3j9x2ab");
  });

  it("sends one chosen picture as the cover and several as the collage", () => {
    const next = uids();
    let b: Board = { ...newBoard("b", "Films", 1, next), category: "games" };
    b = addToPool(b, [{ title: "a", imageUrl: null }], 2, next);
    expect(publishRequestOf({ ...b, coverImageUrls: ["https://x/1.jpg"] })?.coverImageUrl).toBe(
      "https://x/1.jpg",
    );
    const two = publishRequestOf({ ...b, coverImageUrls: ["https://x/1.jpg", "https://x/2.jpg"] })!;
    expect(two.coverImageUrl).toBeNull();
    expect(two.coverImageUrls).toHaveLength(2);
  });
});

describe("an own photo on the cover", () => {
  const own =
    "https://firebasestorage.googleapis.com/v0/b/b/o/users%2Fme%2Fpictures%2Fpic-1?alt=media&token=t";
  const board = () => {
    const next = uids();
    const b: Board = { ...newBoard("b", "Trips", 1, next), category: "travel", anonymous: true };
    return addToPool(
      b,
      [
        { title: "Holiday", imageUrl: own, pictureId: "pic-1" },
        { title: "Poster", imageUrl: "https://x/p.jpg" },
      ],
      2,
      next,
    );
  };

  it("goes by id alone, so its private address, which names the account, never travels", () => {
    const request = publishRequestOf({ ...board(), coverImageUrls: [own] })!;
    expect(request.coverPictureId).toBe("pic-1");
    expect(request.coverImageUrl).toBeNull();
    expect(request.coverImageUrls).toEqual([]);
    expect(JSON.stringify(request)).not.toContain("users%2F");
  });

  it("stays out of a collage, which keeps the rest", () => {
    const request = publishRequestOf({ ...board(), coverImageUrls: [own, "https://x/p.jpg"] })!;
    expect(request.coverPictureId).toBeNull();
    expect(request.coverImageUrls).toEqual(["https://x/p.jpg"]);
    expect(JSON.stringify(request)).not.toContain("users%2F");
  });

  it("is never sent by a private address, even with its card gone", () => {
    const request = publishRequestOf({ ...board(), coverImageUrls: ["https://x/p.jpg", own] })!;
    expect(request.coverImageUrls).toEqual(["https://x/p.jpg"]);
  });
});

describe("a picture's credit", () => {
  it("goes out with the card it belongs to, and nowhere else", () => {
    const next = uids();
    let b: Board = { ...newBoard("b", "Foxes", 1, next), category: "animals" };
    b = addToPool(
      b,
      [
        { title: "Red fox", imageUrl: "https://x/f.jpg", credit: "(c) Jane Doe (CC BY)" },
        { title: "Fennec", imageUrl: "https://x/n.jpg" },
      ],
      2,
      next,
    );
    expect(liveItems(b).map((item) => item.credit)).toEqual(["(c) Jane Doe (CC BY)", null]);
    const [fox, fennec] = publishRequestOf(b)!.items;
    expect(fox).toMatchObject({ title: "Red fox", credit: "(c) Jane Doe (CC BY)" });
    expect(fennec).not.toHaveProperty("credit");
  });
});

describe("a published list as a board of one's own", () => {
  const list: PublishedList = {
    id: "abc",
    title: "Every A24 film, ranked",
    authorUid: "u1",
    authorName: "danylo",
    authorPhotoUrl: null,
    category: "film_tv",
    itemCount: 3,
    coverImageUrl: null,
    previewImages: [],
    tierColors: [],
    updatedAt: 0,
    takeCount: 0,
    tiers: [
      { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
      { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
    ],
    items: [
      { title: "Ex Machina", imageUrl: "https://x/e.jpg", tierIndex: 0 },
      { title: "The Witch", imageUrl: null, tierIndex: 1 },
      { title: "Climax", imageUrl: null, tierIndex: null },
    ],
  };

  it("takes their tiers and cards, in the arrangement asked for", () => {
    const board = boardFromList(list, [[2], [0]], 5, uids());
    expect(board.title).toBe(list.title);
    expect(board.category).toBe("film_tv");
    // A section the site has no words of its own for comes along all the same.
    expect(boardFromList({ ...list, category: "street-food" }, null, 5, uids()).category).toBe(
      "street-food",
    );
    expect(board.authorName).toBe("danylo");
    expect(board.publishedId).toBeNull();
    expect(rankedTiers(board).map((tier) => tier.label)).toEqual(["S", "A"]);
    expect(rankedTiers(board)[0]?.caption).toBe("Masterpiece");
    const [s, a] = rankedTiers(board);
    expect(itemsIn(board, s!.uid).map((item) => item.title)).toEqual(["Climax"]);
    expect(itemsIn(board, a!.uid).map((item) => item.title)).toEqual(["Ex Machina"]);
    expect(itemsIn(board, poolTier(board)!.uid).map((item) => item.title)).toEqual(["The Witch"]);
    expect(board.items.find((item) => item.title === "Ex Machina")?.imageUrl).toBe(
      "https://x/e.jpg",
    );
    expect(poolTier(board)?.position).toBe(2);
  });

  it("keeps the photographers the pictures ask to be named by", () => {
    const credited: PublishedList = {
      ...list,
      items: [{ ...list.items[0]!, credit: " (c)  Jane Doe " }, list.items[1]!, list.items[2]!],
    };
    const board = boardFromList(credited, null, 5, uids());
    expect(liveItems(board).map((item) => item.credit)).toEqual(["(c) Jane Doe", null, null]);
  });

  it("keeps the list it came from and sends it with a publish, as the app does", () => {
    const board = { ...boardFromList(list, [[2], [0]], 5, uids()), category: "film_tv" };
    expect(board.takenFrom).toBe("abc");
    expect(publishRequestOf(board)?.takenFrom).toBe("abc");
    // A board of one's own names no list it came from.
    expect(publishRequestOf({ ...board, takenFrom: null })).not.toHaveProperty("takenFrom");
  });

  it("leaves every card in the pool when no arrangement is wanted", () => {
    const board = boardFromList(list, null, 5, uids());
    expect(itemsIn(board, poolTier(board)!.uid).map((item) => item.title)).toEqual([
      "Ex Machina",
      "The Witch",
      "Climax",
    ]);
  });
});
