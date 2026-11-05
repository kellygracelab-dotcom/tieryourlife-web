import { describe, expect, it } from "vitest";
import type { PublishedList } from "../../api/types";
import { boardForOwnList } from "./ownList";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const tier = (label: string) => ({
  label,
  caption: null,
  colorLight: "#ff0000",
  colorDark: "#aa0000",
});

const ownAnonymous: PublishedList = {
  id: "L9",
  title: "Films",
  anonymous: true,
  mine: true,
  authorUid: "",
  authorName: "",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 1,
  takeCount: 0,
  topicId: "t1",
  topicName: "A24",
  tiers: [tier("S"), tier("A")],
  items: [
    {
      title: "Alpha",
      imageUrl: "https://img.test/a.jpg",
      credit: "Photo by Ann Example (CC BY 4.0)",
      tierIndex: 0,
    },
    {
      title: "Beta",
      imageUrl: "https://img.test/b.jpg",
      credit: "Bob Lens / Wikimedia",
      tierIndex: 1,
    },
    { title: "Gamma", imageUrl: null, tierIndex: null },
  ],
};

const noCopies = () => Promise.reject(new Error("nothing to copy back"));

describe("boardForOwnList", () => {
  it("comes back as nameless as the list went out, in its topic, with every credit", async () => {
    const board = await boardForOwnList(ownAnonymous, null, noCopies, 5, uids());
    expect(board.publishedId).toBe("L9");
    expect(board.anonymous).toBe(true);
    expect(board.topic).toEqual({ id: "t1", name: "A24" });
    expect(board.items.map((item) => [item.title, item.credit])).toEqual([
      ["Alpha", "Photo by Ann Example (CC BY 4.0)"],
      ["Beta", "Bob Lens / Wikimedia"],
      ["Gamma", null],
    ]);
  });

  it("stays named when the list went out with its author's name, and in no topic when it had none", async () => {
    const named = { ...ownAnonymous, anonymous: false, topicId: null, topicName: null };
    const board = await boardForOwnList(named, null, noCopies, 5, uids());
    expect(board.anonymous).toBe(false);
    expect(board.topic).toBeNull();
  });
});
