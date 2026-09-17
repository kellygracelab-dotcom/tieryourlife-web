import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  followAuthor,
  getFollowState,
  getSuggestedAuthors,
  REPORT_REASONS,
  reportList,
  unfollowAuthor,
} from "./community";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("community", () => {
  it("files a complaint about a list with its reason and note", async () => {
    const { client, request } = recordingClient(undefined);
    await expect(
      reportList(client, "a b", { reason: "spam", note: "Sells things" }),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("POST", "/lists/a%20b/report", {
      body: { reason: "spam", note: "Sells things" },
    });
    expect(REPORT_REASONS).toEqual(["sexual", "hate", "violence", "spam", "other"]);
  });

  it("reads, starts and ends following an author, escaping the uid", async () => {
    const { client, request } = recordingClient({ following: true, followers: 3 });
    await expect(getFollowState(client, "u/1")).resolves.toEqual({ following: true, followers: 3 });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow/u%2F1");
    await followAuthor(client, "u1");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/follow/u1");
    await unfollowAuthor(client, "u1");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/follow/u1");
  });

  it("asks for authors worth following", async () => {
    const { client, request } = recordingClient({ authors: [] });
    await expect(getSuggestedAuthors(client)).resolves.toEqual({ authors: [] });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow");
  });
});
