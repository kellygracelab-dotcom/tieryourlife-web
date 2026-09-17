import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { getFeed, getList, recordTake, unpublishList } from "./lists";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("lists", () => {
  it("reads one list by id, escaping the id", async () => {
    const { client, request } = recordingClient({ id: "a b" });

    await expect(getList(client, "a b")).resolves.toEqual({ id: "a b" });

    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b");
  });

  it("reads a feed page with the filters as query", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });

    await getFeed(client, { category: "games", sort: "popular", following: true });

    expect(request).toHaveBeenCalledWith("GET", "/lists", {
      query: { category: "games", sort: "popular", following: true },
    });
  });

  it("reads the first feed page with no filters at all", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });

    await getFeed(client);

    expect(request).toHaveBeenCalledWith("GET", "/lists", { query: {} });
  });

  it("unpublishes one list by id, escaping the id", async () => {
    const { client, request } = recordingClient(undefined);

    await expect(unpublishList(client, "a/b")).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledWith("DELETE", "/lists/a%2Fb");
  });

  it("records a take once per person", async () => {
    const { client, request } = recordingClient({ counted: true });

    await expect(recordTake(client, "abc")).resolves.toEqual({ counted: true });

    expect(request).toHaveBeenCalledWith("POST", "/lists/abc/taken");
  });
});
