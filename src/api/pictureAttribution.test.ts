import { describe, expect, it } from "vitest";
import { itemsOf } from "./lists";
import {
  attributionField,
  attributionOf,
  isTmdbPicture,
  knownSourceOf,
  sameAttribution,
} from "./pictureAttribution";

describe("a picture's attribution", () => {
  it("keeps the known fields, plain and within their limits", () => {
    expect(
      attributionOf({
        source: "wikimedia",
        author: `  Jane \n  Doe ${"x".repeat(400)}`,
        license: ` CC BY-SA 4.0 ${"y".repeat(200)}`,
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        link: "https://commons.wikimedia.org/wiki/File:Fox.jpg",
        originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fox.jpg",
        extra: "dropped",
      }),
    ).toEqual({
      source: "wikimedia",
      author: `Jane Doe ${"x".repeat(291)}`,
      license: `CC BY-SA 4.0 ${"y".repeat(87)}`,
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      link: "https://commons.wikimedia.org/wiki/File:Fox.jpg",
      originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fox.jpg",
    });
    const kept = attributionOf({ source: "wikimedia", author: "x".repeat(300) });
    expect(kept?.author).toHaveLength(300);
    expect(attributionOf({ source: "web" })).toEqual({ source: "web" });
  });

  it("takes https addresses only, whole and within 500 characters", () => {
    const long = `https://www.inaturalist.org/photos/${"1".repeat(470)}`;
    expect(long.length).toBeGreaterThan(500);
    expect(
      attributionOf({
        source: "inaturalist",
        author: "   ",
        license: 4,
        licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
        link: long,
        originalUrl: "javascript:alert(1)",
      }),
    ).toEqual({ source: "inaturalist" });
    expect(
      attributionOf({ source: "tmdb", link: "https://user:pw@www.themoviedb.org/movie/1" }),
    ).toEqual({ source: "tmdb" });
    expect(attributionOf({ source: "tmdb", link: "https://" })).toEqual({ source: "tmdb" });
    const edge = `https://www.themoviedb.org/movie/${"2".repeat(500 - 33)}`;
    expect(edge).toHaveLength(500);
    expect(attributionOf({ source: "tmdb", link: edge })?.link).toBe(edge);
  });

  it("keeps a source it does not know yet, and reads it as unknown", () => {
    const later = attributionOf({
      source: "musicbrainz",
      link: "https://musicbrainz.org/release/1",
      originalUrl: "https://coverartarchive.org/release/1/front",
    });
    // Kept, so its link and original address still go back with a publish.
    expect(later).toEqual({
      source: "musicbrainz",
      link: "https://musicbrainz.org/release/1",
      originalUrl: "https://coverartarchive.org/release/1/front",
    });
    expect(knownSourceOf(later)).toBeNull();
    expect(knownSourceOf({ source: "steam" })).toBe("steam");
    expect(knownSourceOf(null)).toBeNull();
    expect(isTmdbPicture(later, "tmdb:1")).toBe(false);
  });

  it("is none without a source fit to be one, or as anything but an object", () => {
    for (const raw of [
      null,
      undefined,
      "tmdb",
      ["tmdb"],
      {},
      { source: "" },
      { source: 4 },
      { source: "TMDB <b>" },
      { source: "x".repeat(41) },
    ]) {
      expect(attributionOf(raw)).toBeNull();
    }
  });

  it("goes only on a card with a picture", () => {
    expect(attributionField("https://image.tmdb.org/t/p/w500/a.jpg", { source: "tmdb" })).toEqual({
      attribution: { source: "tmdb" },
    });
    expect(attributionField(null, { source: "tmdb" })).toEqual({});
    expect(attributionField("https://x/a.jpg", null)).toEqual({});
  });

  it("says TMDB by the attribution, by the catalogue id only for a hit without one", () => {
    expect(isTmdbPicture({ source: "tmdb" }, "wikidata:Q1")).toBe(true);
    expect(isTmdbPicture({ source: "tmdb" })).toBe(true);
    // A copy of ours, or anything the attribution says is not TMDB's, is not, whatever its id.
    expect(isTmdbPicture({ source: "web" }, "tmdb:movie:1")).toBe(false);
    expect(isTmdbPicture(undefined, "tmdb:movie:1")).toBe(true);
    expect(isTmdbPicture(null, "anilist:1")).toBe(false);
    expect(isTmdbPicture(undefined)).toBe(false);
  });

  it("compares two attributions by their fields", () => {
    expect(sameAttribution(undefined, null)).toBe(true);
    expect(sameAttribution({ source: "tmdb" }, { source: "tmdb" })).toBe(true);
    expect(sameAttribution({ source: "tmdb" }, undefined)).toBe(false);
    expect(
      sameAttribution(
        { source: "tmdb", link: "https://www.themoviedb.org/movie/1" },
        { source: "tmdb", link: "https://www.themoviedb.org/movie/2" },
      ),
    ).toBe(false);
  });

  it("is read off a published list's cards, cleaned, and none on a card without a picture", () => {
    const items = itemsOf([
      {
        title: "Fox",
        imageUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/published%2Fl1%2Fw-abc",
        attribution: {
          source: "inaturalist",
          author: " Ann ",
          originalUrl: "https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpg",
          licenseUrl: "http://plain",
        },
      },
      { title: "Gone", imageUrl: "null", attribution: { source: "tmdb" } },
      { title: "Odd", imageUrl: "https://x/a.jpg", attribution: "tmdb" },
      { title: "Old", imageUrl: "https://x/b.jpg" },
    ]);
    expect(items[0]?.attribution).toEqual({
      source: "inaturalist",
      author: "Ann",
      originalUrl: "https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpg",
    });
    expect(items[1]).not.toHaveProperty("attribution");
    expect(items[2]).not.toHaveProperty("attribution");
    expect(items[3]).not.toHaveProperty("attribution");
  });
});

describe("a picture's catalogue id and its former addresses", () => {
  it("keeps the catalogue's id in the shapes the backend names, and an unknown catalogue's own", () => {
    for (const id of [
      "tmdb:movie:603",
      "tmdb:person:287",
      "anilist:c40",
      "igdb:1942",
      "steam:620",
      "openlibrary:OL45W",
      "newcat:Abc123",
    ]) {
      expect(attributionOf({ source: "tmdb", id })?.id).toBe(id);
    }
    for (const id of [
      "",
      "TMDB:1",
      "tmdb",
      "tmdb:",
      "tmdb:movie 603",
      `a:${"1".repeat(61)}`,
      603,
    ]) {
      expect(attributionOf({ source: "tmdb", id })).not.toHaveProperty("id");
    }
  });

  it("keeps up to five https former addresses, oldest first, and drops the rest", () => {
    const urls = [1, 2, 3, 4, 5, 6].map((n) => `https://img.test/${n}.jpg`);
    expect(
      attributionOf({
        source: "anilist",
        formerUrls: ["http://img.test/0.jpg", 7, `https://img.test/${"x".repeat(500)}`, ...urls],
      })?.formerUrls,
    ).toEqual(urls.slice(0, 5));
    expect(attributionOf({ source: "anilist", formerUrls: [] })).not.toHaveProperty("formerUrls");
    expect(attributionOf({ source: "anilist", formerUrls: "https://img.test/1.jpg" })).toEqual({
      source: "anilist",
    });
  });

  it("tells two attributions apart by the id and the former addresses", () => {
    const one = { source: "tmdb", id: "tmdb:movie:603", formerUrls: ["https://img.test/a.jpg"] };
    expect(sameAttribution(one, { ...one })).toBe(true);
    expect(sameAttribution(one, { ...one, id: "tmdb:movie:604" })).toBe(false);
    expect(sameAttribution(one, { ...one, formerUrls: [] })).toBe(false);
    expect(sameAttribution({ source: "tmdb" }, { source: "tmdb", formerUrls: [] })).toBe(true);
  });
});
