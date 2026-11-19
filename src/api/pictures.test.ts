import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  keepPicture,
  linkPicture,
  linkQuota,
  pictureOf,
  scopeFor,
  searchPictureBatch,
  searchPictures,
  uploadsLeft,
} from "./pictures";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

const raw = (more: Record<string, unknown> = {}) => ({
  id: "anilist:20",
  title: "Naruto",
  subtitle: "2002",
  imageUrl: "https://img.test/naruto.jpg",
  thumbUrl: "https://img.test/naruto-small.jpg",
  source: "anilist",
  kind: "anime",
  ...more,
});

describe("pictures", () => {
  it("looks in a board's own section where it has catalogues, and in all of them otherwise", () => {
    expect(scopeFor("anime")).toBe("anime");
    expect(scopeFor("film_tv")).toBe("film_tv");
    expect(scopeFor("people")).toBe("people");
    expect(scopeFor("animals")).toBe("animals");
    expect(scopeFor("food")).toBe("all");
    expect(scopeFor("knitting")).toBe("all");
    expect(scopeFor(null)).toBe("all");
    expect(scopeFor(undefined)).toBe("all");
  });

  it("asks in the scope, page and language given, and for the web only when told", async () => {
    const { client, request } = recordingClient({ items: [raw()], hasMore: true, notices: [] });
    const page = await searchPictures(client, {
      q: "  naruto ",
      scope: "anime",
      page: 2,
      web: false,
      lang: "pt-BR",
    });
    expect(request).toHaveBeenCalledWith("GET", "/lists/pictures", {
      query: { q: "naruto", scope: "anime", lang: "pt-BR", page: 2 },
    });
    expect(page).toEqual({
      items: [
        {
          id: "anilist:20",
          title: "Naruto",
          subtitle: "2002",
          imageUrl: "https://img.test/naruto.jpg",
          thumbUrl: "https://img.test/naruto-small.jpg",
          source: "anilist",
          kind: "anime",
          credit: null,
          attribution: null,
        },
      ],
      hasMore: true,
      notices: [],
      rest: false,
    });

    await searchPictures(client, {
      q: "x".repeat(120),
      scope: "all",
      page: 1,
      web: true,
      lang: "en",
    });
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/pictures", {
      query: { q: "x".repeat(100), scope: "all", lang: "en", page: 1, web: 1 },
    });
  });

  it("keeps a hit's attribution, cleaned, and none from a backend that sends none", () => {
    expect(
      pictureOf(
        raw({
          id: "tmdb:movie:438631",
          source: "tmdb",
          attribution: {
            source: "tmdb",
            link: "https://www.themoviedb.org/movie/438631",
            author: "  ",
            licenseUrl: "http://example.test/",
          },
        }),
      )?.attribution,
    ).toEqual({ source: "tmdb", link: "https://www.themoviedb.org/movie/438631" });
    expect(pictureOf(raw())?.attribution).toBeNull();
    expect(pictureOf(raw({ attribution: { link: "https://x" } }))?.attribution).toBeNull();
  });

  it("keeps how many rated a game, where the backend says, and nothing that is not a count", () => {
    expect(pictureOf(raw({ id: "igdb:1514", source: "igdb", popularity: 2400 }))?.popularity).toBe(
      2400,
    );
    expect(pictureOf(raw())).not.toHaveProperty("popularity");
    for (const wrong of [-1, "12", Number.NaN, null]) {
      expect(pictureOf(raw({ popularity: wrong }))).not.toHaveProperty("popularity");
    }
  });

  it("keeps only answers it can draw, and only the notices it knows", async () => {
    const { client } = recordingClient({
      items: [
        raw({ id: "a" }),
        raw({ id: "b", imageUrl: "http://img.test/plain.jpg" }),
        raw({ id: "c", title: "  " }),
        raw({ id: "" }),
        null,
        raw({ id: "d", thumbUrl: "http://small", subtitle: "", source: "mystery", kind: "?" }),
        raw({
          id: "e",
          thumbUrl: null,
          source: "inaturalist",
          kind: "animal",
          credit: " (c) Jane Doe, some rights reserved (CC BY) ",
        }),
      ],
      notices: ["webDailyLimit", "somethingNew", 4],
    });
    const page = await searchPictures(client, {
      q: "na",
      scope: "all",
      page: 1,
      web: false,
      lang: "en",
    });
    expect(page.items.map((item) => item.id)).toEqual(["a", "d", "e"]);
    // A catalogue not known yet is still a catalogue, never the web.
    expect(page.items[1]).toMatchObject({
      thumbUrl: null,
      subtitle: null,
      source: "other",
      kind: "thing",
      credit: null,
    });
    expect(page.items[2]).toMatchObject({
      thumbUrl: null,
      source: "inaturalist",
      kind: "animal",
      credit: "(c) Jane Doe, some rights reserved (CC BY)",
    });
    expect(page.notices).toEqual(["webDailyLimit"]);
    expect(page.hasMore).toBe(false);

    // An answer without its fields is an empty last page.
    const empty = recordingClient({});
    await expect(
      searchPictures(empty.client, { q: "na", scope: "all", page: 1, web: false, lang: "en" }),
    ).resolves.toEqual({ items: [], hasMore: false, notices: [], rest: false });
    expect(pictureOf("text")).toBeNull();
  });

  it("says the list's section and topic, and reads how sure the search is of each hit", async () => {
    const { client, request } = recordingClient({
      items: [
        raw({ id: "a", matchedName: "Kyiv", confidence: "high", doubts: [] }),
        raw({ id: "b", confidence: "low", doubts: ["namesakes", "somethingNew", 3, "otherKind"] }),
        raw({ id: "c", confidence: "sure", matchedName: "  ", kind: "plant" }),
      ],
      hasMore: false,
      notices: [],
      searchedAs: { text: "Kyiv", how: "translated" },
    });
    const page = await searchPictures(client, {
      q: "Киев",
      scope: "all",
      page: 1,
      web: false,
      lang: "ru",
      section: "places",
      topic: "cities",
    });
    expect(request).toHaveBeenCalledWith("GET", "/lists/pictures", {
      query: { q: "Киев", scope: "all", lang: "ru", page: 1, section: "places", topic: "cities" },
    });
    expect(page.searchedAs).toEqual({ text: "Kyiv", how: "translated" });
    expect(page.items[0]).toMatchObject({ matchedName: "Kyiv", confidence: "high", doubts: [] });
    // Doubts this page does not know yet are left unsaid.
    expect(page.items[1]).toMatchObject({ confidence: "low", doubts: ["namesakes", "otherKind"] });
    // A kind this page does not draw yet is a thing; an unknown confidence is none.
    expect(page.items[2]?.kind).toBe("thing");
    expect(page.items[2]).not.toHaveProperty("confidence");
    expect(page.items[2]).not.toHaveProperty("matchedName");

    // An empty section or topic is not sent, and a broken searchedAs is not read.
    const other = recordingClient({ items: [], searchedAs: { text: " ", how: "x" } });
    const none = await searchPictures(other.client, {
      q: "up",
      scope: "all",
      page: 1,
      web: false,
      lang: "en",
      section: "",
      topic: "",
    });
    expect(other.request).toHaveBeenCalledWith("GET", "/lists/pictures", {
      query: { q: "up", scope: "all", lang: "en", page: 1 },
    });
    expect(none).not.toHaveProperty("searchedAs");
  });

  it("says which catalogues were busy, and when they may be asked again", async () => {
    const ask = { q: "naruto", scope: "anime", page: 1, web: false, lang: "en" } as const;
    const busy = recordingClient({
      items: [raw()],
      hasMore: false,
      notices: [],
      busy: ["anilist", 3, ""],
      retryAt: 1_800_000_060_000,
    });
    await expect(searchPictures(busy.client, ask)).resolves.toMatchObject({
      busy: ["anilist"],
      retryAt: 1_800_000_060_000,
    });

    // A time that is no time is left out; the busy catalogues are still said.
    for (const retryAt of ["soon", Number.NaN, Number.POSITIVE_INFINITY, -5, null]) {
      const page = await searchPictures(
        recordingClient({ items: [], busy: ["tmdb"], retryAt }).client,
        ask,
      );
      expect(page.busy).toEqual(["tmdb"]);
      expect(page).not.toHaveProperty("retryAt");
    }

    // None busy, or nothing readable: neither is said.
    for (const answer of [{ busy: [] }, { busy: "anilist" }, { retryAt: 5 }, {}]) {
      const page = await searchPictures(recordingClient({ items: [], ...answer }).client, ask);
      expect(page).not.toHaveProperty("busy");
      expect(page).not.toHaveProperty("retryAt");
    }
  });

  it("has the backend copy a web picture, and wants its id back", async () => {
    const { client, request } = recordingClient({ pictureId: "p1" });
    await expect(keepPicture(client, "https://site.test/a.jpg")).resolves.toBe("p1");
    expect(request).toHaveBeenCalledWith("POST", "/lists/pictures/keep", {
      body: { url: "https://site.test/a.jpg" },
    });
    await expect(
      keepPicture(recordingClient({}).client, "https://site.test/a.jpg"),
    ).rejects.toThrow();
  });
});

describe("a picture from a link", () => {
  const quota = { left: 7, limit: 50, resetsAt: 1_800_000_000_000 };

  it("sends the address, the page and the credit, and takes the copy it became", async () => {
    const { client, request } = recordingClient({
      pictureId: "pic_1-a",
      attribution: { source: "web", link: "https://site.test/page" },
      quota,
    });
    await expect(
      linkPicture(client, {
        url: "https://site.test/a.jpg",
        link: "https://site.test/page",
        credit: "Jane",
      }),
    ).resolves.toEqual({
      pictureId: "pic_1-a",
      imageUrl: null,
      attribution: { source: "web", link: "https://site.test/page" },
      credit: null,
      quota,
    });
    expect(request).toHaveBeenCalledWith("POST", "/lists/pictures/link", {
      body: { url: "https://site.test/a.jpg", link: "https://site.test/page", credit: "Jane" },
    });
  });

  it("sends only the address when that is all there is", async () => {
    const { client, request } = recordingClient({ pictureId: "p1" });
    const answer = await linkPicture(client, { url: "https://site.test/a.jpg" });
    expect(request).toHaveBeenCalledWith("POST", "/lists/pictures/link", {
      body: { url: "https://site.test/a.jpg" },
    });
    expect(answer).toEqual({
      pictureId: "p1",
      imageUrl: null,
      attribution: null,
      credit: null,
      quota: null,
    });
  });

  it("keeps a catalogue's address as it is, with the catalogue's attribution and credit", async () => {
    const { client } = recordingClient({
      imageUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
      attribution: { source: "tmdb", id: "tmdb:movie:603" },
      credit: "TMDB",
      quota,
    });
    await expect(
      linkPicture(client, { url: "https://www.themoviedb.org/movie/603" }),
    ).resolves.toEqual({
      pictureId: null,
      imageUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
      attribution: { source: "tmdb", id: "tmdb:movie:603" },
      credit: "TMDB",
      quota,
    });
  });

  it("takes no answer without a picture in it", async () => {
    for (const answer of [
      {},
      { pictureId: "../escape" },
      { pictureId: "x".repeat(101) },
      { imageUrl: "http://img.test/a.jpg" },
      { imageUrl: 5 },
    ]) {
      await expect(
        linkPicture(recordingClient(answer).client, { url: "https://site.test/a.jpg" }),
      ).rejects.toThrow("no picture");
    }
  });

  it("reads today's quota before anything is sent", async () => {
    const { client, request } = recordingClient({ quota });
    await expect(linkQuota(client)).resolves.toEqual(quota);
    expect(request).toHaveBeenCalledWith("GET", "/lists/pictures/link");
    await expect(linkQuota(recordingClient({}).client)).resolves.toBeNull();
  });
});

describe("the batch of a pasted list's names (stage 2)", () => {
  it("sends the names with the list's section, and reads one result a name, in order", async () => {
    const { client, request } = recordingClient({
      results: [
        { q: "naruto", status: "found", item: raw({ confidence: "high" }) },
        {
          q: "Bleech",
          status: "unsure",
          item: raw({ id: "anilist:1", confidence: "low", doubts: ["spelling"] }),
          searchedAs: { text: "Bleach", how: "spelling" },
        },
        { q: "zz", status: "none" },
        { q: "One Piece", status: "busy", retryAt: 1_700_000_000_000 },
        { q: "Naruto 2", status: "limited", retryAt: "soon" },
        { q: "Death Note", status: "later" },
        { q: "Odd", status: "what" },
      ],
    });
    const names = [
      " naruto ",
      "Bleech",
      "zz",
      "One Piece",
      "Naruto 2",
      "Death Note",
      "Odd",
      "x".repeat(120),
    ];
    const results = await searchPictureBatch(client, {
      names,
      scope: "anime",
      section: "anime",
      lang: "en",
    });
    expect(request).toHaveBeenCalledWith("POST", "/lists/pictures/batch", {
      body: {
        names: [
          "naruto",
          "Bleech",
          "zz",
          "One Piece",
          "Naruto 2",
          "Death Note",
          "Odd",
          "x".repeat(100),
        ],
        scope: "anime",
        lang: "en",
        section: "anime",
      },
    });
    expect(results.map((one) => one.status)).toEqual([
      "found",
      "unsure",
      "none",
      "busy",
      "limited",
      "later",
      // A status this page does not know, and a result missing, are names to ask again.
      "later",
      "later",
    ]);
    expect(results[0]).toMatchObject({
      q: "naruto",
      item: { id: "anilist:20", confidence: "high" },
    });
    expect(results[1]).toMatchObject({
      item: { confidence: "low", doubts: ["spelling"] },
      searchedAs: { text: "Bleach", how: "spelling" },
    });
    expect(results[3]).toEqual({ q: "One Piece", status: "busy", retryAt: 1_700_000_000_000 });
    expect(results[4]).toEqual({ q: "Naruto 2", status: "limited", retryAt: null });
  });
});

// Proxy #174 (19.11.2026).
describe("the day's own uploads", () => {
  it("asks for a whole selection, at most a hundred at once, and reads the answer", async () => {
    const { client, request } = recordingClient({
      uploads: {
        used: 185,
        left: 15,
        limit: 200,
        guest: true,
        warnAt: 180,
        resetsAt: 1_800_000_000_000,
      },
    });
    await expect(uploadsLeft(client, 3)).resolves.toEqual({
      used: 185,
      left: 15,
      limit: 200,
      guest: true,
      warnAt: 180,
      resetsAt: 1_800_000_000_000,
    });
    expect(request).toHaveBeenCalledWith("GET", "/lists/pictures/uploads", { query: { count: 3 } });
    await uploadsLeft(client, 250);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/pictures/uploads", {
      query: { count: 100 },
    });
  });

  it("takes an answer it cannot read as room enough", async () => {
    const { client } = recordingClient({});
    await expect(uploadsLeft(client, 1)).resolves.toMatchObject({
      left: Number.POSITIVE_INFINITY,
      warnAt: null,
    });
  });
});
