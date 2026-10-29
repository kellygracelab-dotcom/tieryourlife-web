import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  followAuthor,
  followState,
  loadListRankings,
  suggestedAuthors,
  REPORT_REASONS,
  report,
  unfollowAuthor,
  withdrawListRanking,
  arrangementOf,
  keepListRanking,
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
      report(client, "a b", { reason: "spam", note: "Sells things" }),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("POST", "/lists/a%20b/report", {
      body: { reason: "spam", note: "Sells things" },
    });
    expect(REPORT_REASONS).toEqual([
      "sexual",
      "violence",
      "hate",
      "spam",
      "other",
      "wrong_category",
    ]);
  });

  it("reads, starts and ends following an author, escaping the uid", async () => {
    const { client, request } = recordingClient({ following: true, followers: 3 });
    await expect(followState(client, "u/1")).resolves.toEqual({ following: true, followers: 3 });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow/u%2F1");
    await followAuthor(client, "u1");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/follow/u1");
    await unfollowAuthor(client, "u1");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/follow/u1");
  });

  it("reads a list's rankings a page at a time and withdraws one's own", async () => {
    const { client, request } = recordingClient({ rankings: [], nextCursor: null });
    await expect(loadListRankings(client, "a b")).resolves.toEqual({
      rankings: [],
      nextCursor: null,
    });
    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b/rankings", {});
    await loadListRankings(client, "abc", "abc_u7");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/abc/rankings", {
      query: { after: "abc_u7" },
    });
    await withdrawListRanking(client, "abc");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/abc/rankings/mine");
  });

  it("puts one's own placing among a list's rankings in the app's shape", async () => {
    // Rows of positions become, card by card in the list's order, the row's index.
    expect(arrangementOf([[2, 0], [], [1]], 4)).toEqual([0, 2, 0, null]);
    expect(arrangementOf([[7]], 2)).toEqual([null, null]);
    const { client, request } = recordingClient({ uid: "u1" });
    await keepListRanking(client, "a b", { arrangement: [0, null], tierLabels: ["S", "A"] });
    expect(request).toHaveBeenCalledWith("PUT", "/lists/a%20b/rankings/mine", {
      body: { arrangement: [0, null], tierLabels: ["S", "A"] },
    });
  });

  it("asks for authors worth following", async () => {
    const { client, request } = recordingClient({ authors: [] });
    await expect(suggestedAuthors(client)).resolves.toEqual({ authors: [] });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow");
  });
});
