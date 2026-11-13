import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  loadFeed,
  loadList,
  loadMyLists,
  publish,
  recordTake,
  republish,
  revisionOf,
  unpublish,
  type PublishRequest,
} from "./lists";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("lists", () => {
  it("reads one list by id, escaping the id", async () => {
    const { client, request } = recordingClient({ id: "a b" });

    await expect(loadList(client, "a b")).resolves.toMatchObject({ id: "a b" });

    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b");
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
    });
  });

  it("reads the first feed page with no filters at all", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });

    await loadFeed(client);

    expect(request).toHaveBeenCalledWith("GET", "/lists", { query: {} });
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
