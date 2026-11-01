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
  rowsOf,
  keepListRanking,
  noteSearchMiss,
} from "./community";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("community", () => {
  it("tells the backend what a search found nothing for", async () => {
    const { client, request } = recordingClient(undefined);
    await expect(noteSearchMiss(client, "sumo")).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("POST", "/lists/search-misses", { body: { q: "sumo" } });
  });

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

  it("puts one's own placing among a list's rankings with the order inside each tier", async () => {
    // The order inside a row is kept; one row per tier, a missing one empty.
    expect(rowsOf([[2, 0], [], [1]], 3, 4)).toEqual([[2, 0], [], [1]]);
    expect(rowsOf([[1]], 3, 2)).toEqual([[1], [], []]);
    // A row past the list's tiers goes, and with it its cards, to the pool.
    expect(rowsOf([[0], [1]], 1, 2)).toEqual([[0]]);
    // A card the list no longer has, a stray number, or one already placed is left out.
    expect(
      rowsOf(
        [
          [7, -1, 0.5, 1],
          [1, 0],
        ],
        2,
        2,
      ),
    ).toEqual([[1], [0]]);
    const { client, request } = recordingClient({ uid: "u1" });
    await keepListRanking(client, "a b", { tierLabels: ["S", "A"], rows: [[1, 0], []] });
    expect(request).toHaveBeenCalledWith("PUT", "/lists/a%20b/rankings/mine", {
      body: { tierLabels: ["S", "A"], rows: [[1, 0], []] },
    });
  });

  it("asks for authors worth following", async () => {
    const { client, request } = recordingClient({ authors: [] });
    await expect(suggestedAuthors(client)).resolves.toEqual({ authors: [] });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow");
  });
});
