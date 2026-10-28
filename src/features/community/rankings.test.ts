import { afterEach, describe, expect, it } from "vitest";
import type { ReaderRanking } from "../../api/community";
import type { PublishedTier } from "../../api/types";
import { setStrings } from "../../strings";
import { placedBy, placedOn, readersOf } from "./rankings";

const tier = (label: string): PublishedTier => ({
  label,
  caption: null,
  colorLight: "#b03a32",
  colorDark: "#f1948c",
});

const list = {
  tiers: [tier("S"), tier("A")],
  items: ["Ex Machina", "The Witch", "Climax", "Moonlight"].map((title) => ({
    title,
    imageUrl: null,
  })),
};

const ranking = (extra: Partial<ReaderRanking>): ReaderRanking => ({
  uid: "u5",
  authorName: "olena",
  authorPhotoUrl: null,
  arrangement: [],
  tierLabels: [],
  updatedAtMs: 0,
  mine: false,
  ...extra,
});

afterEach(() => setStrings("en", null));

describe("placedBy", () => {
  it("puts the list's cards where the reader put them, the rest in the pool", () => {
    expect(placedBy(list, ranking({ arrangement: [1, 0, null, 0] }))).toEqual({
      tiers: list.tiers,
      rows: [[1, 3], [0]],
      pool: [2],
    });
  });

  it("leaves unranked a card the arrangement is too short for or names a tier the list lacks", () => {
    const { rows, pool } = placedBy(list, ranking({ arrangement: [0, 7] }));
    expect(rows).toEqual([[0], []]);
    expect(pool).toEqual([1, 2, 3]);
  });

  it("names the tiers with the reader's words, and keeps the author's where they gave none", () => {
    const { tiers } = placedBy(list, ranking({ tierLabels: ["Best", " "] }));
    expect(tiers.map((one) => one.label)).toEqual(["Best", "A"]);
    expect(tiers[0]?.colorLight).toBe("#b03a32");
  });
});

describe("readersOf", () => {
  it("keeps the rankings with a reader and a name, and leaves out the site's own strays", () => {
    const stray = { arrangement: [], tierLabels: [], updatedAtMs: 1, mine: false };
    const nameless = { ...ranking({}), authorName: undefined };
    const kept = ranking({});
    expect(
      readersOf([kept, stray, nameless, ranking({ uid: "" })] as unknown as ReaderRanking[]),
    ).toEqual([kept]);
  });
});

describe("placedOn", () => {
  const noon = new Date(2026, 9, 28, 12).getTime();

  it("says today and yesterday by the calendar, not by twenty-four hours", () => {
    expect(placedOn(new Date(2026, 9, 28, 0, 5).getTime(), noon)).toBe("Today");
    expect(placedOn(new Date(2026, 9, 27, 23, 55).getTime(), noon)).toBe("Yesterday");
  });

  it("names the day further back, in the page's language", () => {
    expect(placedOn(new Date(2026, 9, 3, 18).getTime(), noon)).toBe("Oct 3, 2026");
    setStrings("uk", { rankings: { today: "Сьогодні" } });
    expect(placedOn(noon, noon)).toBe("Сьогодні");
    expect(placedOn(new Date(2026, 9, 3).getTime(), noon)).toMatch(/2026/);
  });
});
