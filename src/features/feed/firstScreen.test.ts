import { describe, expect, it } from "vitest";
import type { ListSummary } from "../../api/types";
import { firstScreenOf, keepPlaces } from "./firstScreen";

const summary = (id: string): ListSummary => ({
  id,
  title: id,
  authorUid: "u1",
  authorName: "Ann",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 10,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

describe("Community's first screen as the page draws it", () => {
  it("orders the tiles as the live answer would, keeps Popular's cursor, and drops what is not drawable", () => {
    const screen = firstScreenOf({
      sections: [
        { id: "games", name: "Games", status: "approved", rank: null, lists30d: 9, approvedAt: 1 },
        {
          id: "film_tv",
          name: "Film & TV",
          status: "approved",
          rank: 1,
          lists30d: 0,
          pictureUrl: "https://tieryourlife.com/img/original/sections/film_tv/abc",
        },
        { id: "other", name: "Other", status: "approved", rank: 0, lists30d: 99 },
        { id: "quiet", name: "Quiet", status: "approved", rank: null, lists30d: 2, approvedAt: 2 },
      ],
      fresh: [summary("n1")],
      popular: { lists: [summary("a1"), summary("a2")], nextCursor: "a2" },
    });
    expect(screen?.sections?.map((one) => one.id)).toEqual(["film_tv", "games", "quiet", "other"]);
    expect(screen?.sections?.[0]?.picture).toBe(
      "https://tieryourlife.com/img/original/sections/film_tv/abc",
    );
    expect(screen?.sections?.every((one) => !one.following)).toBe(true);
    expect(screen?.popular).toEqual({ lists: [summary("a1"), summary("a2")], next: "a2" });
    expect(screen?.fresh?.map((one) => one.id)).toEqual(["n1"]);
  });

  it("leaves out each part that does not read right, on its own", () => {
    const screen = firstScreenOf({
      sections: [{ name: "no id" }],
      fresh: [summary("n1")],
      popular: { lists: [{ id: "x" }], nextCursor: null },
    });
    expect(screen).toEqual({ sections: null, fresh: [summary("n1")], popular: null });
    expect(firstScreenOf(null)).toBeNull();
    expect(firstScreenOf({ sections: [], fresh: null, popular: null })).toEqual({
      sections: null,
      fresh: null,
      popular: null,
    });
  });

  it("keeps the cards one sees in their places: the live words in place, a gone list's place to the next, new ones after", () => {
    const live = [summary("new"), { ...summary("a1"), takeCount: 7 }, summary("a3"), summary("a4")];
    const kept = keepPlaces(["a1", "gone", "a3"], live);
    expect(kept.map((one) => one.id)).toEqual(["a1", "new", "a3", "a4"]);
    expect(kept[0]?.takeCount).toBe(7);
    expect(keepPlaces(["a1"], []).map((one) => one.id)).toEqual([]);
  });
});
