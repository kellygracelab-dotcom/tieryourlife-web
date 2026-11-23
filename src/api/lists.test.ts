import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  loadFeed,
  loadList,
  loadMyLists,
  publish,
  recordTake,
  republish,
  collageSrcOf,
  revisionOf,
  summaryOf,
  unpublish,
  type PublishRequest,
} from "./lists";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("summaryOf", () => {
  const list = {
    id: "l",
    title: "T",
    coverImageUrl: "https://img/c.jpg",
    previewImages: [],
  } as unknown as Parameters<typeof summaryOf>[0];

  it("keeps a cover's focus in range, the middle too, and none of the wrong shape or with no cover", () => {
    const focus = { x: 0.3, y: 0.15, zoom: 2 };
    expect(summaryOf({ ...list, coverFocus: focus }).coverFocus).toEqual(focus);
    expect(summaryOf({ ...list, coverFocus: { x: 0.5, y: 0.5, zoom: 1 } }).coverFocus).toEqual({
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
    expect(summaryOf({ ...list, coverFocus: { x: 0.3, y: 0.15, zoom: 9 } })).not.toHaveProperty(
      "coverFocus",
    );
    expect(summaryOf({ ...list, coverImageUrl: null, coverFocus: focus })).not.toHaveProperty(
      "coverFocus",
    );
  });

  it("keeps a source with words and an https page, and none of any other shape", () => {
    const listSource = { label: "Nix's fruit stream", url: "https://www.twitch.tv/videos/1" };
    expect(summaryOf({ ...list, listSource }).listSource).toEqual(listSource);
    for (const wrong of [
      { label: " ", url: listSource.url },
      { label: "Nix", url: "http://www.twitch.tv/videos/1" },
      { label: "Nix", url: "javascript:alert(1)" },
      { label: "Nix", url: "https://me:pw@twitch.tv/" },
      { label: "Nix", url: "https://twitch.tv:8443/" },
      { label: 3, url: listSource.url },
      "Nix",
    ]) {
      expect(
        summaryOf({ ...list, listSource: wrong as unknown as typeof listSource }),
      ).not.toHaveProperty("listSource");
    }
  });
});

describe("collageSrcOf", () => {
  it("reads the site's own collage on any of its hosts as a path on this origin", () => {
    const path = "/img/collage/list-0001.webp?v=1700000000000";
    for (const host of [
      "tieryourlife.com",
      "www.tieryourlife.com",
      "tieryourlife.web.app",
      "tieryourlife.firebaseapp.com",
    ]) {
      expect(collageSrcOf(`https://${host}${path}`)).toBe(path);
    }
    // Read once already: kept as it is.
    expect(collageSrcOf(path)).toBe(path);
  });

  it("refuses another host, another path, another scheme and anything not an address", () => {
    for (const wrong of [
      "https://evil.example/img/collage/list-0001.webp",
      "https://tieryourlife.com.evil.example/img/collage/list-0001.webp",
      "http://tieryourlife.com/img/collage/list-0001.webp",
      "https://tieryourlife.com:8443/img/collage/list-0001.webp",
      "https://me@tieryourlife.com/img/collage/list-0001.webp",
      "https://tieryourlife.com/img/original/published/list-0001/p",
      "https://tieryourlife.com/img/collage/list-0001.png",
      "https://tieryourlife.com/img/collage/../l/list-0001.webp",
      "https://tieryourlife.com/img/collage/short.webp",
      "//evil.example/img/collage/list-0001.webp",
      "/\\evil.example/img/collage/list-0001.webp",
      "javascript:alert(1)",
      "",
      3,
      null,
      undefined,
    ]) {
      expect(collageSrcOf(wrong)).toBeNull();
    }
  });

  it("goes with a list read, and twice read stays", () => {
    const list = {
      id: "list-0001",
      title: "T",
      coverImageUrl: null,
      previewImages: ["https://img/a.jpg", "https://img/b.jpg"],
      collageUrl: "https://tieryourlife.com/img/collage/list-0001.webp?v=5",
    } as unknown as Parameters<typeof summaryOf>[0];
    const once = summaryOf(list);
    expect(once.collageUrl).toBe("/img/collage/list-0001.webp?v=5");
    expect(summaryOf(once).collageUrl).toBe("/img/collage/list-0001.webp?v=5");
    expect(
      summaryOf({ ...list, collageUrl: "https://evil.example/img/collage/list-0001.webp" }),
    ).not.toHaveProperty("collageUrl");
  });
});

describe("lists", () => {
  it("reads one list by id, escaping the id", async () => {
    const { client, request } = recordingClient({ id: "a b" });

    await expect(loadList(client, "a b")).resolves.toMatchObject({ id: "a b" });

    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b");
  });

  it("reads a card's focus only on a card with a picture, and only in range", async () => {
    const focus = { x: 0.3, y: 0.15, zoom: 2 };
    const { client } = recordingClient({
      id: "abc",
      title: "Animals",
      tiers: [],
      items: [
        { title: "Fox", imageUrl: "https://img/fox.jpg", pictureFocus: focus },
        { title: "Words", imageUrl: null, pictureFocus: focus },
        { title: "Odd", imageUrl: "https://img/odd.jpg", pictureFocus: { x: 3, y: 0, zoom: 1 } },
      ],
    });
    const list = await loadList(client, "abc");
    expect(list.items[0]?.pictureFocus).toEqual(focus);
    expect(list.items[1]).not.toHaveProperty("pictureFocus");
    expect(list.items[2]).not.toHaveProperty("pictureFocus");
  });

  it("draws what it can of a list that came slightly wrong, keeping every card in its place", async () => {
    const { client } = recordingClient({
      id: "abc",
      title: "Films",
      authorName: null,
      tiers: [null, { label: "A", caption: null, colorLight: "#111", colorDark: "#222" }],
      items: [
        { title: null, imageUrl: "https://img/a.jpg", tierIndex: 1 },
        null,
        { title: "Climax", imageUrl: 42 },
      ],
    });
    const list = await loadList(client, "abc");
    expect(list.authorName).toBe("");
    expect(list.tiers.map((tier) => tier.label)).toEqual(["", "A"]);
    expect(list.items).toEqual([
      { title: "", imageUrl: "https://img/a.jpg", tierIndex: 1 },
      { title: "", imageUrl: null },
      { title: "Climax", imageUrl: null },
    ]);
  });

  it("reads a feed page with the filters as query", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });

    await loadFeed(client, { category: "games", sort: "popular", following: true });

    expect(request).toHaveBeenCalledWith("GET", "/lists", {
      query: { category: "games", sort: "popular", following: true },
      // No longer than this for App Check: past it the feed says the browser was not checked.
      appCheckWaitMs: 5_000,
    });
  });

  it("reads the first feed page with no filters at all", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });

    await loadFeed(client);

    expect(request).toHaveBeenCalledWith("GET", "/lists", { query: {}, appCheckWaitMs: 5_000 });
  });

  it("leaves out the empty slots among a list's pictures, in the feed and in one's own lists", async () => {
    const list = {
      id: "l1",
      title: "Oscar films 2025",
      coverImageUrl: "",
      previewImages: ["https://img/a.jpg", null, "", "https://img/b.jpg"],
    };
    const { client } = recordingClient({ lists: [list], nextCursor: null });
    const page = await loadFeed(client);
    expect(page.lists[0]).toMatchObject({
      coverImageUrl: null,
      previewImages: ["https://img/a.jpg", "https://img/b.jpg"],
    });
    const mine = await loadMyLists(recordingClient({ lists: [list] }).client);
    expect(mine.lists[0]?.previewImages).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
    // A clean list is passed on as it came.
    const clean = { ...list, coverImageUrl: null, previewImages: ["https://img/a.jpg"] };
    const again = await loadFeed(recordingClient({ lists: [clean], nextCursor: null }).client);
    expect(again.lists[0]).toBe(clean);
  });

  it('takes only https:// addresses for pictures: the word "null" kept as a cover is none', async () => {
    const list = {
      id: "l2",
      title: "Comfort rewatches",
      coverImageUrl: "null",
      previewImages: ["https://img/a.jpg", "null", "assets/null"],
    };
    const page = await loadFeed(recordingClient({ lists: [list], nextCursor: null }).client);
    expect(page.lists[0]).toMatchObject({
      coverImageUrl: null,
      previewImages: ["https://img/a.jpg"],
    });
  });

  it("opens one list with the same care for its cover and its cards' pictures", async () => {
    const list = {
      id: "l3",
      title: "Sequels",
      coverImageUrl: "null",
      previewImages: [],
      tiers: [],
      items: [
        { title: "A", imageUrl: "null" },
        { title: "B", imageUrl: "https://img/b.jpg" },
        { title: "C", imageUrl: null },
      ],
    };
    const opened = await loadList(recordingClient(list).client, "l3");
    expect(opened.coverImageUrl).toBeNull();
    expect(opened.items.map((item) => item.imageUrl)).toEqual([null, "https://img/b.jpg", null]);
  });

  it("reads a house list's credit for its cover, cleaned, and none without a cover", async () => {
    const credit = {
      manual: true,
      author: " Jane ",
      license: "CC BY 4.0",
      link: "https://commons.wikimedia.org/wiki/File:Fox.jpg",
    };
    const list = {
      id: "h1",
      title: "Foxes",
      coverImageUrl: "https://img/fox.jpg",
      previewImages: [],
      tiers: [],
      items: [],
      coverAttribution: credit,
    };
    const opened = await loadList(recordingClient(list).client, "h1");
    expect(opened.coverAttribution).toEqual({
      author: "Jane",
      license: "CC BY 4.0",
      link: "https://commons.wikimedia.org/wiki/File:Fox.jpg",
    });
    const coverless = await loadList(
      recordingClient({ ...list, coverImageUrl: null }).client,
      "h1",
    );
    expect(coverless).not.toHaveProperty("coverAttribution");
    const broken = await loadList(
      recordingClient({ ...list, coverAttribution: { license: "CC0 1.0" } }).client,
      "h1",
    );
    expect(broken).not.toHaveProperty("coverAttribution");
  });

  it("reads a cover credited to its title's page in a catalogue, and not a manual one as that", async () => {
    const list = {
      id: "h1",
      title: "Films",
      coverImageUrl: "https://image.tmdb.org/t/p/w500/d.jpg",
      previewImages: [],
      tiers: [],
      items: [],
      coverAttribution: { source: "tmdb", link: "https://www.themoviedb.org/movie/438631" },
    };
    const opened = await loadList(recordingClient(list).client, "h1");
    expect(opened.coverCatalogue).toEqual({
      source: "tmdb",
      link: "https://www.themoviedb.org/movie/438631",
    });
    const manual = await loadList(
      recordingClient({
        ...list,
        coverAttribution: { manual: true, author: "Jane", link: "https://x.test/p" },
      }).client,
      "h1",
    );
    expect(manual).not.toHaveProperty("coverCatalogue");
    const coverless = await loadList(
      recordingClient({ ...list, coverImageUrl: null }).client,
      "h1",
    );
    expect(coverless).not.toHaveProperty("coverCatalogue");
  });

  it("cuts a feed collage by each preview's focus, kept in step with the previews it keeps", async () => {
    const focus = { x: 0.5, y: 0.1, zoom: 1 };
    const { client } = recordingClient({
      lists: [
        {
          id: "a",
          title: "Films",
          coverImageUrl: null,
          previewImages: ["javascript:alert(1)", "https://img/a.jpg", "https://img/b.jpg"],
          previewFocus: [focus, null, focus],
          tierColors: [],
        },
        {
          id: "b",
          title: "Plain",
          coverImageUrl: null,
          previewImages: ["https://img/c.jpg"],
          previewFocus: [null],
          tierColors: [],
        },
      ],
    });
    const [films, plain] = (await loadFeed(client)).lists;
    expect(films!.previewImages).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
    expect(films!.previewFocus).toEqual([null, focus]);
    expect(plain).not.toHaveProperty("previewFocus");
  });

  it("republishes one list in place, escaping the id", async () => {
    const { client, request } = recordingClient({ id: "a b" });
    const body: PublishRequest = {
      title: "T",
      category: "anime",
      coverImageUrl: null,
      coverPictureId: null,
      tiers: [],
      items: [],
    };

    await expect(republish(client, "a b", body)).resolves.toEqual({ id: "a b" });

    expect(request).toHaveBeenCalledWith("POST", "/lists/a%20b", { body });
  });

  it("reads a list's revision, a whole number from 0, and none from anything else", async () => {
    for (const [revision, read] of [
      [0, 0],
      [7, 7],
      [-1, undefined],
      [1.5, undefined],
      ["3", undefined],
      [null, undefined],
      [Number.MAX_SAFE_INTEGER + 1, undefined],
    ] as const) {
      expect(revisionOf(revision)).toBe(read);
      const { client } = recordingClient({ id: "a", tiers: [], items: [], revision });
      const list = await loadList(client, "a");
      if (read === undefined) expect(list).not.toHaveProperty("revision");
      else expect(list.revision).toBe(read);
    }
  });

  it("hands on the revision a publish or a replace answered with, and sends baseRevision as given", async () => {
    const body: PublishRequest = {
      title: "T",
      category: "anime",
      coverImageUrl: null,
      coverPictureId: null,
      baseRevision: 4,
      tiers: [],
      items: [],
    };
    const { client, request } = recordingClient({ id: "a", topicId: null, revision: 5 });
    await expect(republish(client, "a", body)).resolves.toEqual({
      id: "a",
      topicId: null,
      revision: 5,
    });
    expect(request).toHaveBeenCalledWith("POST", "/lists/a", { body });
    const odd = recordingClient({ id: "b", existing: true, revision: "5" });
    await expect(publish(odd.client, body)).resolves.toEqual({ id: "b", existing: true });
  });

  it("unpublishes one list by id, escaping the id", async () => {
    const { client, request } = recordingClient(undefined);

    await expect(unpublish(client, "a/b")).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledWith("DELETE", "/lists/a%2Fb");
  });

  it("records a take once per person", async () => {
    const { client, request } = recordingClient({ counted: true });

    await expect(recordTake(client, "abc")).resolves.toEqual({ counted: true });

    expect(request).toHaveBeenCalledWith("POST", "/lists/abc/taken");
  });
});
