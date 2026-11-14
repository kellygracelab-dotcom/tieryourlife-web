import { describe, expect, it } from "vitest";
import {
  creditOfFields,
  creditProblemsOf,
  deedOf,
  EDITOR_LICENCES,
  fieldsOf,
  isCataloguePage,
  readsFromPage,
  type CreditFields,
} from "./editorCredit";

const COMMONS = "https://commons.wikimedia.org/wiki/File:Red_fox.jpg";
const FLICKR = "https://www.flickr.com/photos/someone/53123456789/";
const INAT = "https://www.inaturalist.org/observations/123456";
const OTHER = "https://example.com/fox";

const fields = (change: Partial<CreditFields> = {}): CreditFields => ({
  author: "",
  licence: "",
  link: "",
  ...change,
});

describe("a house editor's credit form", () => {
  it("offers the licences the backend takes, in the shape it keeps them", () => {
    expect(EDITOR_LICENCES).toEqual([
      "CC0 1.0",
      "CC BY 4.0",
      "CC BY 3.0",
      "CC BY 2.5",
      "CC BY 2.0",
      "CC BY 1.0",
      "CC BY-SA 4.0",
      "CC BY-SA 3.0",
      "CC BY-SA 2.5",
      "CC BY-SA 2.0",
      "CC BY-SA 1.0",
      "Public domain",
      "Used with permission",
    ]);
  });

  it("links a Creative Commons licence to its deed, and no other", () => {
    expect(deedOf("CC0 1.0")).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(deedOf("CC BY 2.5")).toBe("https://creativecommons.org/licenses/by/2.5/");
    expect(deedOf("CC BY-SA 4.0")).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(deedOf("Public domain")).toBeNull();
    expect(deedOf("Used with permission")).toBeNull();
  });

  it("waits for a licence and an https page, and says which is missing", () => {
    expect(creditProblemsOf(fields())).toEqual(["needLicence", "needLink"]);
    expect(creditProblemsOf(fields({ licence: "CC0 1.0" }))).toEqual(["needLink"]);
    expect(creditProblemsOf(fields({ link: OTHER }))).toEqual(["needLicence"]);
    expect(creditProblemsOf(fields({ licence: "CC0 1.0", link: "http://example.com/x" }))).toEqual([
      "badLink",
    ]);
    expect(creditProblemsOf(fields({ licence: "CC0 1.0", link: "fox" }))).toEqual(["badLink"]);
    expect(
      creditProblemsOf(fields({ licence: "CC0 1.0", link: `${OTHER}/${"x".repeat(500)}` })),
    ).toEqual(["linkTooLong"]);
    expect(creditProblemsOf(fields({ licence: "CC0 1.0", link: OTHER }))).toEqual([]);
  });

  it("knows the three pages the backend reads the author and licence from", () => {
    for (const page of [
      COMMONS,
      FLICKR,
      "https://flickr.com/photos/someone/53123456789",
      INAT,
      "https://inaturalist.org/observations/123456?tab=photos",
    ]) {
      expect(readsFromPage(page), page).toBe(true);
    }
    for (const page of [
      OTHER,
      "https://commons.wikimedia.org/wiki/Main_Page",
      "https://www.flickr.com/photos/someone/",
      "https://www.inaturalist.org/taxa/42069",
      "http://commons.wikimedia.org/wiki/File:Red_fox.jpg",
    ]) {
      expect(readsFromPage(page), page).toBe(false);
    }
  });

  it("saves with only the link for those pages, and leaves the licence to the backend", () => {
    for (const link of [COMMONS, FLICKR, INAT]) {
      expect(creditProblemsOf(fields({ link }))).toEqual([]);
      expect(creditOfFields(fields({ link }))).toEqual({ link });
    }
    expect(creditOfFields(fields({ link: OTHER }))).toBeNull();
  });

  it("knows a catalogue's page for a title, a slug, query or slash after it", () => {
    for (const page of [
      "https://www.themoviedb.org/movie/603-the-matrix",
      "https://themoviedb.org/tv/1399",
      "https://www.themoviedb.org/collection/2344?language=uk",
      "https://anilist.co/anime/1/Cowboy-Bebop/",
      "https://anilist.co/manga/30013",
      "https://www.igdb.com/games/hollow-knight",
      "https://igdb.com/games/celeste/",
      "https://store.steampowered.com/app/570/Dota_2/",
      "https://openlibrary.org/works/OL45804W/Fantastic_Mr_Fox",
    ]) {
      expect(isCataloguePage(page), page).toBe(true);
    }
    for (const page of [
      "http://www.themoviedb.org/movie/603",
      "https://www.themoviedb.org/person/6384",
      "https://www.themoviedb.org/movie/the-matrix",
      "https://anilist.co/character/1",
      "https://www.igdb.com/companies/nintendo",
      "https://store.steampowered.com/bundle/232",
      "https://openlibrary.org/books/OL7353617M",
      "https://evil.test/https://anilist.co/anime/1",
      OTHER,
    ]) {
      expect(isCataloguePage(page), page).toBe(false);
    }
  });

  it("takes a catalogue's page with no licence only for a topic's picture", () => {
    const link = "https://www.themoviedb.org/movie/603-the-matrix";
    expect(creditProblemsOf(fields({ link }))).toEqual(["needLicence"]);
    expect(creditOfFields(fields({ link }))).toBeNull();
    expect(creditProblemsOf(fields({ link }), { catalogue: true })).toEqual([]);
    expect(creditOfFields(fields({ link }), { catalogue: true })).toEqual({ link });
    // Any other page still asks for a licence there.
    expect(creditProblemsOf(fields({ link: OTHER }), { catalogue: true })).toEqual(["needLicence"]);
  });

  it("makes the credit: spaces tidied, the deed with a CC licence, nothing left empty", () => {
    expect(
      creditOfFields(fields({ author: "  Jane   Doe ", licence: "CC BY 4.0", link: ` ${OTHER} ` })),
    ).toEqual({
      author: "Jane Doe",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      link: OTHER,
    });
    expect(creditOfFields(fields({ licence: "Used with permission", link: OTHER }))).toEqual({
      license: "Used with permission",
      link: OTHER,
    });
  });

  it("starts from what the picture says, its licence only when it is one of the list", () => {
    expect(
      fieldsOf({ source: "wikimedia", author: "Jane", license: "cc by-sa 4.0", link: COMMONS }),
    ).toEqual({ author: "Jane", licence: "CC BY-SA 4.0", link: COMMONS });
    expect(fieldsOf({ source: "wikimedia", license: "GFDL" }).licence).toBe("");
    expect(fieldsOf(null)).toEqual(fields());
  });
});
