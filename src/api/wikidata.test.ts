import { describe, expect, it, vi } from "vitest";
import {
  commonsThumbnail,
  detailsByQid,
  detailsQuery,
  searchWikidata,
  wikidataLanguage,
  type Fetcher,
} from "./wikidata";

const answering = (...bodies: unknown[]): ReturnType<typeof vi.fn<Fetcher>> => {
  const fetcher = vi.fn<Fetcher>();
  for (const body of bodies) {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  return fetcher;
};

describe("wikidataLanguage", () => {
  it("keeps a tag of one or two parts and cuts a longer one to its language", () => {
    expect(wikidataLanguage("ru")).toBe("ru");
    expect(wikidataLanguage("pt-BR")).toBe("pt-br");
    expect(wikidataLanguage("zh-Hant-TW")).toBe("zh");
  });

  it("falls back to English when there is no language to speak of", () => {
    expect(wikidataLanguage(null)).toBe("en");
    expect(wikidataLanguage("  ")).toBe("en");
    expect(wikidataLanguage("und")).toBe("en");
  });
});

describe("the details", () => {
  it("asks only for what looks like a subject", () => {
    const query = detailsQuery(["Q89", "Q1) } DROP", "q5", "Q312"]);
    expect(query).toContain("VALUES ?item { wd:Q89 wd:Q312 }");
    expect(query).toContain("wdt:P18");
    expect(query).toContain("wdt:P154");
    expect(query).toContain("wdt:P4947");
  });

  it("asks Commons for a picture 500 wide, over https", () => {
    expect(commonsThumbnail("http://commons.wikimedia.org/wiki/Special:FilePath/Apple.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Apple.jpg?width=500",
    );
    expect(commonsThumbnail("https://commons.wikimedia.org/x?y=1", 200)).toBe(
      "https://commons.wikimedia.org/x?y=1&width=200",
    );
  });

  it("takes the photograph before the logo, and the first of each", () => {
    const details = detailsByQid({
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q312" },
            image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/HQ.jpg" },
            logo: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Logo.svg" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q312" },
            image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q7" },
            logo: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Badge.svg" },
            tmdb: { value: "603" },
          },
          { image: { value: "nobody's" } },
        ],
      },
    });
    expect(details.get("Q312")).toEqual({
      imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/HQ.jpg?width=500",
      linkedTmdbId: null,
    });
    expect(details.get("Q7")).toEqual({
      imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Badge.svg?width=500",
      linkedTmdbId: 603,
    });
    expect(details.size).toBe(2);
  });
});

describe("searchWikidata", () => {
  it("searches in the reader's language, then asks the details of what it found", async () => {
    const fetcher = answering(
      {
        search: [
          { id: "Q89", label: "apple", description: "fruit of the apple tree" },
          { id: "Q312", label: "Apple Inc." },
          { id: "not a subject", label: "?" },
        ],
      },
      {
        results: {
          bindings: [
            {
              item: { value: "http://www.wikidata.org/entity/Q89" },
              image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Apple.jpg" },
            },
          ],
        },
      },
    );

    await expect(searchWikidata("apple", "pt-BR", fetcher)).resolves.toEqual([
      {
        item: {
          id: "wikidata:Q89",
          title: "apple",
          subtitle: "fruit of the apple tree",
          imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Apple.jpg?width=500",
        },
        linkedTmdbId: null,
      },
      {
        item: { id: "wikidata:Q312", title: "Apple Inc.", subtitle: null, imageUrl: null },
        linkedTmdbId: null,
      },
    ]);

    const search = new URL(fetcher.mock.calls[0]![0]);
    expect(search.origin + search.pathname).toBe("https://www.wikidata.org/w/api.php");
    expect(Object.fromEntries(search.searchParams)).toEqual({
      action: "wbsearchentities",
      search: "apple",
      language: "pt-br",
      uselang: "pt-br",
      type: "item",
      format: "json",
      limit: "20",
      origin: "*",
    });
    const details = new URL(fetcher.mock.calls[1]![0]);
    expect(details.origin + details.pathname).toBe("https://query.wikidata.org/sparql");
    expect(details.searchParams.get("format")).toBe("json");
    expect(details.searchParams.get("query")).toContain("VALUES ?item { wd:Q89 wd:Q312 }");
  });

  it("asks no details when the search found nothing", async () => {
    const fetcher = answering({ search: [] });
    await expect(searchWikidata("zzzz", "en", fetcher)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails when Wikidata does not answer", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response("busy", { status: 429 }));
    await expect(searchWikidata("apple", "en", fetcher)).rejects.toThrow("429");
  });
});
