import { describe, expect, it, vi } from "vitest";
import { cardOf, mergeCatalogues, searchCatalogue, searchEverywhere } from "./catalogue";
import type { ApiClient } from "./client";
import type { Fetcher } from "./wikidata";

describe("cardOf", () => {
  it("makes a card from a film with its poster and year", () => {
    expect(
      cardOf({
        id: 603,
        media_type: "movie",
        title: " The Matrix ",
        poster_path: "/matrix.jpg",
        release_date: "1999-03-31",
      }),
    ).toEqual({
      id: "tmdb:603",
      title: "The Matrix",
      subtitle: "1999",
      imageUrl: "https://image.tmdb.org/t/p/w500/matrix.jpg",
    });
  });

  it("names a series by its name and first air date, with a still when there is no poster", () => {
    expect(
      cardOf({
        id: 1,
        media_type: "tv",
        name: "Severance",
        backdrop_path: "/still.jpg",
        first_air_date: "2022-02-18",
      }),
    ).toEqual({
      id: "tmdb:1",
      title: "Severance",
      subtitle: "2022",
      imageUrl: "https://image.tmdb.org/t/p/w500/still.jpg",
    });
  });

  it("pictures a person by their photograph and what they are known for", () => {
    expect(
      cardOf({
        id: 2,
        media_type: "person",
        name: "Greta Gerwig",
        profile_path: "/greta.jpg",
        poster_path: "/never.jpg",
        known_for_department: "Directing",
      }),
    ).toEqual({
      id: "tmdb:2",
      title: "Greta Gerwig",
      subtitle: "Directing",
      imageUrl: "https://image.tmdb.org/t/p/w500/greta.jpg",
    });
  });

  it.each([
    ["a kind it has no card for", { id: 3, media_type: "collection", name: "X" }],
    ["a film without a name", { id: 4, media_type: "movie", title: "  " }],
    ["a row without an id", { media_type: "movie", title: "Nameless" }],
    ["nothing at all", null],
  ])("makes nothing of %s", (_name, raw) => {
    expect(cardOf(raw)).toBeNull();
  });

  it("leaves the picture and the year out when the catalogue has none", () => {
    expect(cardOf({ id: 5, media_type: "movie", title: "Obscure", release_date: "" })).toEqual({
      id: "tmdb:5",
      title: "Obscure",
      subtitle: null,
      imageUrl: null,
    });
  });
});

describe("searchCatalogue", () => {
  it("asks the combined search with App Check alone and keeps only what makes a card", async () => {
    const request = vi.fn(async () => ({
      results: [
        { id: 1, media_type: "movie", title: "One", release_date: "2001-01-01" },
        { id: 2, media_type: "collection", name: "Skipped" },
      ],
    }));
    const client = { request } as unknown as ApiClient;

    await expect(searchCatalogue(client, "one")).resolves.toEqual([
      { id: "tmdb:1", title: "One", subtitle: "2001", imageUrl: null },
    ]);
    expect(request).toHaveBeenCalledWith("GET", "/3/search/multi", {
      query: { query: "one", include_adult: false, language: "en-US", page: 1 },
      auth: "appCheckOnly",
    });
  });

  it("reads an answer without results as none", async () => {
    const client = { request: vi.fn(async () => ({})) } as unknown as ApiClient;
    await expect(searchCatalogue(client, "x")).resolves.toEqual([]);
  });
});

describe("the two catalogues as one", () => {
  const film = (id: number, title: string, imageUrl: string | null = "https://img/p.jpg") => ({
    id: `tmdb:${id}`,
    title,
    subtitle: "1999",
    imageUrl,
  });
  const subject = (
    qid: string,
    title: string,
    linkedTmdbId: number | null = null,
    imageUrl: string | null = null,
  ) => ({ item: { id: `wikidata:${qid}`, title, subtitle: null, imageUrl }, linkedTmdbId });

  it("leaves a film Wikidata knows by its TMDB number to TMDB, and takes one from each in turn", () => {
    const merged = mergeCatalogues(
      "zz",
      [film(603, "The Matrix"), film(604, "The Matrix Reloaded")],
      [subject("Q83495", "The Matrix", 603), subject("Q1", "Matrix (mathematics)")],
    );
    expect(merged.map((item) => item.id)).toEqual(["tmdb:603", "tmdb:604", "wikidata:Q1"]);
  });

  it("puts the exact name first, then names that begin with the words, and a picture breaks ties", () => {
    const merged = mergeCatalogues(
      "apple",
      [film(1, "Pineapple Express"), film(2, "Apple", null)],
      [
        subject("Q89", "apple", null, "https://commons/apple.jpg"),
        subject("Q312", "Apple Inc."),
        subject("Q9", "Applejack", null, "https://commons/jack.jpg"),
      ],
    );
    expect(merged.map((item) => item.title)).toEqual([
      "apple",
      "Apple",
      "Applejack",
      "Apple Inc.",
      "Pineapple Express",
    ]);
  });

  it("answers with one catalogue when the other does not, and fails when neither does", async () => {
    const tmdb = { results: [{ id: 1, media_type: "movie", title: "One" }] };
    const client = { request: vi.fn(async () => tmdb) } as unknown as ApiClient;
    const down: Fetcher = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(searchEverywhere(client, "one", "en", down)).resolves.toEqual([
      { id: "tmdb:1", title: "One", subtitle: null, imageUrl: null },
    ]);

    const silent = {
      request: vi.fn(async () => Promise.reject(new Error("offline"))),
    } as unknown as ApiClient;
    const up: Fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ search: [{ id: "Q89", label: "apple" }] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { bindings: [] } })));
    await expect(searchEverywhere(silent, "apple", "en", up)).resolves.toEqual([
      { id: "wikidata:Q89", title: "apple", subtitle: null, imageUrl: null },
    ]);

    await expect(searchEverywhere(silent, "apple", "en", down)).rejects.toThrow("offline");
  });
});
