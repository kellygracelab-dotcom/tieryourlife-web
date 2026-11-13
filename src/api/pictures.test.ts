import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  keepPicture,
  linkPicture,
  linkQuota,
  pictureOf,
  scopeFor,
  searchPictures,
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
