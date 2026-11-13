import { describe, expect, it } from "vitest";
import { itemsOf } from "./lists";
import {
  attributionField,
  attributionOf,
  catalogueSourceOf,
  creditAsAttribution,
  editorCreditOf,
  isTmdbPicture,
  knownSourceOf,
  sameAttribution,
  withEditorCredit,
  withoutEditorCredit,
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

describe("a house editor's own credit", () => {
  const COMMONS = "https://commons.wikimedia.org/wiki/File:Fox.jpg";

  it("is kept by the cleaner as manual, true or false, and nothing else", () => {
    const manual = { source: "tmdb", manual: true, author: "Jane", license: "CC0 1.0" };
    expect(attributionOf(manual)).toEqual(manual);
    expect(attributionOf({ source: "web", manual: false })).toEqual({
      source: "web",
      manual: false,
    });
    expect(attributionOf({ source: "web", manual: "yes" })).toEqual({ source: "web" });
    expect(sameAttribution({ source: "web", manual: true }, { source: "web" })).toBe(false);
    expect(itemsOf([{ title: "Fox", imageUrl: COMMONS, attribution: manual }])[0]).toMatchObject({
      attribution: manual,
    });
  });

  it("reads a cover's credit cleaned, and none without its page", () => {
    expect(
      editorCreditOf({
        manual: true,
        author: "  Jane  Doe ",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        link: COMMONS,
        source: "dropped",
        id: "dropped:1",
      }),
    ).toEqual({
      author: "Jane Doe",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      link: COMMONS,
    });
    expect(editorCreditOf({ manual: true, license: "CC0 1.0" })).toBeNull();
    expect(editorCreditOf({ link: "http://plain.test/p" })).toBeNull();
    expect(editorCreditOf(null)).toBeNull();
    expect(editorCreditOf(["x"])).toBeNull();
  });

  it("goes over a card's attribution, keeping its source, id and addresses", () => {
    const before = {
      source: "wikimedia",
      author: "Commons",
      license: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      link: COMMONS,
      originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fox.jpg",
      id: "x:1",
      formerUrls: ["https://upload.wikimedia.org/old.jpg"],
    };
    const credit = { license: "CC0 1.0", link: "https://site.test/fox" };
    expect(withEditorCredit(before, credit, false)).toEqual({
      source: "wikimedia",
      originalUrl: before.originalUrl,
      id: "x:1",
      formerUrls: before.formerUrls,
      manual: true,
      license: "CC0 1.0",
      link: "https://site.test/fox",
    });
    expect(withEditorCredit(before, credit, true).source).toBe("web");
    expect(withEditorCredit(null, credit, false)).toEqual({
      source: "web",
      manual: true,
      ...credit,
    });
    expect(withoutEditorCredit(withEditorCredit(before, credit, false))).toEqual({
      source: "wikimedia",
      originalUrl: before.originalUrl,
      id: "x:1",
      formerUrls: before.formerUrls,
      link: "https://site.test/fox",
      manual: false,
    });
    expect(creditAsAttribution(credit)).toEqual({ source: "web", manual: true, ...credit });
  });
});

describe("the catalogue a picture's address is on", () => {
  it("is told by the catalogues' own hosts", () => {
    expect(
      [
        "https://image.tmdb.org/t/p/w500/x.jpg",
        "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.png",
        "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
        "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
        "https://cdn-images.dzcdn.net/images/cover/x/500x500.jpg",
        "https://covers.openlibrary.org/b/id/1-L.jpg",
        "https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg",
        "https://static.inaturalist.org/photos/1/medium.jpg",
        "https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=500",
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Pizza.jpg",
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Pizza.jpg/500px-Pizza.jpg",
      ].map(catalogueSourceOf),
    ).toEqual([
      "tmdb",
      "anilist",
      "igdb",
      "steam",
      "deezer",
      "openlibrary",
      "inaturalist",
      "inaturalist",
      "wikimedia",
      "wikimedia",
      "wikimedia",
    ]);
  });

  it("is none for any other address: another site, a local Wikipedia's upload, our copy, not https", () => {
    for (const url of [
      "https://img.test/a.jpg",
      "https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.jpg",
      "https://firebasestorage.googleapis.com/v0/b/x/o/published%2Fcatalogue%2Fw-1?alt=media",
      "http://image.tmdb.org/t/p/w500/x.jpg",
      "https://image.tmdb.org.example.com/x.jpg",
      "not an address",
    ]) {
      expect(catalogueSourceOf(url)).toBeNull();
    }
  });

  it("keeps the catalogue address on a card shown from our shared copy", () => {
    const copy =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2Fcatalogue%2Fw-0123456789abcdef0123456789abcdef?alt=media";
    const attribution = { source: "tmdb", originalUrl: "https://image.tmdb.org/t/p/w500/x.jpg" };
    expect(attributionField(copy, attribution)).toEqual({ attribution });
  });
});
