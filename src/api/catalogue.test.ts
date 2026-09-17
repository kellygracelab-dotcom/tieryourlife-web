import { describe, expect, it, vi } from "vitest";
import { cardOf, searchCatalogue } from "./catalogue";
import type { ApiClient } from "./client";

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
