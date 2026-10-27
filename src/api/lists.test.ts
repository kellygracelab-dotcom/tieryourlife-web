import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  loadFeed,
  loadList,
  loadMyLists,
  recordTake,
  republish,
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

    await expect(loadList(client, "a b")).resolves.toEqual({ id: "a b" });

    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b");
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
