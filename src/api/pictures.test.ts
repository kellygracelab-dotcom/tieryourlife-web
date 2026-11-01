import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { keepPicture, pictureOf, scopeFor, searchPictures } from "./pictures";

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
        },
      ],
      hasMore: true,
      notices: [],
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

  it("keeps only answers it can draw, and only the notices it knows", async () => {
    const { client } = recordingClient({
      items: [
        raw({ id: "a" }),
        raw({ id: "b", imageUrl: "http://img.test/plain.jpg" }),
        raw({ id: "c", title: "  " }),
        raw({ id: "" }),
        null,
        raw({ id: "d", thumbUrl: "http://small", subtitle: "", source: "mystery", kind: "?" }),
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
    expect(page.items.map((item) => item.id)).toEqual(["a", "d"]);
    expect(page.items[1]).toMatchObject({
      thumbUrl: null,
      subtitle: null,
      source: "web",
      kind: "thing",
    });
    expect(page.notices).toEqual(["webDailyLimit"]);
    expect(page.hasMore).toBe(false);

    // An answer without its fields is an empty last page.
    const empty = recordingClient({});
    await expect(
      searchPictures(empty.client, { q: "na", scope: "all", page: 1, web: false, lang: "en" }),
    ).resolves.toEqual({ items: [], hasMore: false, notices: [] });
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
