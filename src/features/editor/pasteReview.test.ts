import { describe, expect, it } from "vitest";
import type { PictureKind, PictureSource } from "../../api/pictures";
import {
  doubtOf,
  expectedArea,
  isUnfound,
  needsLook,
  reviewOrder,
  rowDoubt,
  summaryOf,
  type PasteRow,
} from "./pasteReview";

const origin = (kind: PictureKind, source: PictureSource = "tmdb") => ({
  kind,
  source,
  subtitle: null,
});

const row = (index: number, more: Partial<PasteRow> = {}): PasteRow => ({
  index,
  card: { title: `Name ${index}`, imageUrl: `https://img.test/${index}.jpg` },
  origin: origin("thing", "wikidata"),
  missing: null,
  chosen: false,
  pageless: false,
  ...more,
});

const none = (index: number, more: Partial<PasteRow> = {}): PasteRow =>
  row(index, {
    card: { title: `Name ${index}`, imageUrl: null },
    origin: null,
    missing: "notFound",
    ...more,
  });

describe("what a pasted name's picture is compared with", () => {
  it("is the area chosen, and the list's own section when that is All", () => {
    expect(expectedArea("games", "sport")).toBe("games");
    expect(expectedArea("all", "sport")).toBe("sport");
    expect(expectedArea("all", null)).toBeNull();
  });
});

describe("a picture in doubt", () => {
  it("is a film poster in a list of football clubs", () => {
    expect(doubtOf(origin("movie"), "sport")).toBe("movie");
    expect(doubtOf(origin("album", "wikidata"), "sport")).toBe("album");
    // A club's or a player's photo is what the list is about.
    expect(doubtOf(origin("thing", "wikidata"), "sport")).toBeNull();
    expect(doubtOf(origin("person"), "sport")).toBeNull();
  });

  it("is Wikidata's anything where the section has catalogues of its own", () => {
    expect(doubtOf(origin("thing", "wikidata"), "games")).toBe("thing");
    expect(doubtOf(origin("thing", "wikidata"), "film_tv")).toBe("thing");
    expect(doubtOf(origin("game", "igdb"), "games")).toBeNull();
    expect(doubtOf(origin("person"), "film_tv")).toBeNull();
    expect(doubtOf(origin("character", "anilist"), "anime")).toBeNull();
  });

  it("is not Wikidata's photo where it is the section's own catalogue", () => {
    expect(doubtOf(origin("thing", "wikidata"), "music")).toBeNull();
    expect(doubtOf(origin("thing", "wikidata"), "people")).toBeNull();
    expect(doubtOf(origin("thing", "wikidata"), "animals")).toBeNull();
    expect(doubtOf(origin("movie"), "people")).toBe("movie");
    expect(doubtOf(origin("book", "openlibrary"), "food")).toBe("book");
  });

  it("is nothing where the area says nothing, nor a picture from the web", () => {
    expect(doubtOf(origin("movie"), null)).toBeNull();
    expect(doubtOf(origin("movie"), "other")).toBeNull();
    expect(doubtOf(origin("movie"), "my-own-section")).toBeNull();
    expect(doubtOf(origin("web", "web"), "games")).toBeNull();
  });

  it("is nothing once the person chose, nor for their own link's picture", () => {
    const poster = row(0, { origin: origin("movie") });
    expect(rowDoubt(poster, "sport")).toBe("movie");
    expect(rowDoubt({ ...poster, chosen: true }, "sport")).toBeNull();
    expect(rowDoubt({ ...poster, origin: "link" }, "sport")).toBeNull();
    expect(rowDoubt(none(1), "sport")).toBeNull();
  });
});

describe("the check's rows", () => {
  it("puts the names to look at first, each part in the order pasted", () => {
    const rows = [
      row(0),
      row(1, { origin: origin("movie") }),
      none(2),
      row(3),
      none(4, { missing: null, chosen: true }),
      row(5, { origin: origin("tv") }),
    ];
    expect(reviewOrder(rows, "sport").map((one) => one.index)).toEqual([1, 2, 5, 0, 3, 4]);
    // Where nothing is expected, only the names with nothing found come first.
    expect(reviewOrder(rows, null).map((one) => one.index)).toEqual([2, 0, 1, 3, 4, 5]);
  });

  it("tells nothing found from none chosen", () => {
    expect(isUnfound(none(0))).toBe(true);
    expect(isUnfound(none(0, { missing: "searchLimit" }))).toBe(true);
    expect(isUnfound(none(0, { missing: null, chosen: true }))).toBe(false);
    expect(needsLook(none(0, { missing: null, chosen: true }), "sport")).toBe(false);
  });

  it("counts every name once: looks right, needs a look, or has no picture", () => {
    const rows = [
      row(0),
      row(1, { origin: origin("movie") }),
      row(2, { origin: origin("movie"), chosen: true }),
      none(3),
      none(4, { missing: null, chosen: true }),
      row(5, { origin: "link" }),
    ];
    expect(summaryOf(rows, "sport")).toEqual({ names: 6, right: 3, doubtful: 1, none: 2 });
    expect(summaryOf(rows, null)).toEqual({ names: 6, right: 4, doubtful: 0, none: 2 });
    expect(summaryOf([], "sport")).toEqual({ names: 0, right: 0, doubtful: 0, none: 0 });
  });
});
