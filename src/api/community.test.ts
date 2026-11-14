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
  likeListRanking,
  noteSearchMiss,
  rankingsPageOf,
  readerRankingOf,
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
    // The author's arrangement heads the first page (K1).
    expect(request).toHaveBeenCalledWith("GET", "/lists/a%20b/rankings", {
      query: { withAuthor: "1" },
    });
    await loadListRankings(client, "abc", "abc_u7");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/abc/rankings", {
      query: { withAuthor: "1", after: "abc_u7" },
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
    const action = { uid: "fixture", isCurrent: () => true, idToken: async () => "fixture" };
    await keepListRanking(client, "a b", { tierLabels: ["S", "A"], rows: [[1, 0], []] }, action);
    expect(request).toHaveBeenCalledWith("PUT", "/lists/a%20b/rankings/mine", {
      action,
      body: { tierLabels: ["S", "A"], rows: [[1, 0], []] },
    });
  });

  it("sends one's own cards with the placing, and reads them back", async () => {
    const { client, request } = recordingClient({
      uid: "u1",
      mine: true,
      rows: [[0]],
      addedCards: [{ title: "Heat", imageUrl: "https://cdn.test/heat.jpg" }],
      allRows: [[0, 2]],
    });
    const action = { uid: "u1", isCurrent: () => true, idToken: async () => "t" };
    const placing = {
      tierLabels: ["S"],
      rows: [[0, 2]],
      version: 7,
      addedCards: [{ title: "Heat", pictureId: "p1" }],
    };
    const kept = await keepListRanking(client, "abc", placing, action);
    expect(request).toHaveBeenCalledWith("PUT", "/lists/abc/rankings/mine", {
      action,
      body: placing,
    });
    expect(kept.addedCards).toEqual([{ title: "Heat", imageUrl: "https://cdn.test/heat.jpg" }]);
    expect(kept.allRows).toEqual([[0, 2]]);
    // An answer that is no ranking still says the placing went in.
    const odd = recordingClient(undefined);
    await expect(keepListRanking(odd.client, "abc", placing, action)).resolves.toMatchObject({
      mine: true,
      rows: [[0, 2]],
      tierLabels: ["S"],
    });
  });

  it("likes a ranking and takes the like back", async () => {
    const { client, request } = recordingClient({ likedByMe: true });
    await expect(likeListRanking(client, "a b", "u/1", true)).resolves.toEqual({ likedByMe: true });
    expect(request).toHaveBeenLastCalledWith("PUT", "/lists/a%20b/rankings/u%2F1/like");
    const undone = recordingClient({ likedByMe: false });
    await expect(likeListRanking(undone.client, "abc", "u1", false)).resolves.toEqual({
      likedByMe: false,
    });
    expect(undone.request).toHaveBeenLastCalledWith("DELETE", "/lists/abc/rankings/u1/like");
    // An answer without the field says what was asked.
    const bare = recordingClient(null);
    await expect(likeListRanking(bare.client, "abc", "u1", true)).resolves.toEqual({
      likedByMe: true,
    });
  });

  it("reads rankings field by field, the new ones optional", () => {
    // From an older backend: no author, no likes, no added cards.
    expect(
      readerRankingOf({
        uid: "u1",
        authorName: "Olena",
        authorPhotoUrl: "https://faces.test/o.jpg",
        arrangement: [0, null, 1],
        rows: [[0], [2]],
        tierLabels: ["S", "A"],
        updatedAtMs: 5,
        mine: false,
      }),
    ).toEqual({
      uid: "u1",
      authorName: "Olena",
      authorPhotoUrl: "https://faces.test/o.jpg",
      arrangement: [0, null, 1],
      rows: [[0], [2]],
      tierLabels: ["S", "A"],
      updatedAtMs: 5,
      mine: false,
      likedByMe: false,
    });
    // The anonymous author: no uid, no name, no face.
    expect(
      readerRankingOf({ uid: "", authorName: "", authorPhotoUrl: null, isAuthor: true }),
    ).toMatchObject({ uid: "", authorName: "", authorPhotoUrl: null, isAuthor: true, rows: [] });
    // Fields gone wrong are read as none, and the rest stays.
    expect(
      readerRankingOf({
        uid: "u2",
        authorName: 3,
        arrangement: "x",
        rows: [[1, "a", -1], "b"],
        tierLabels: [null, "B"],
        updatedAtMs: "soon",
        likedByMe: "yes",
        addedCards: [{ title: "Heat" }, null],
        allRows: [[3], 7],
      }),
    ).toEqual({
      uid: "u2",
      authorName: "",
      authorPhotoUrl: null,
      arrangement: [],
      rows: [[1], []],
      tierLabels: ["", "B"],
      updatedAtMs: 0,
      mine: false,
      likedByMe: false,
      addedCards: [
        { title: "Heat", imageUrl: null },
        { title: "", imageUrl: null },
      ],
      allRows: [[3], []],
    });
    // allRows without added cards says nothing.
    expect(readerRankingOf({ uid: "u3", allRows: [[0]] })).not.toHaveProperty("allRows");
    expect(readerRankingOf(null)).toBeNull();
    expect(readerRankingOf({ authorName: "no uid" })).toBeNull();
  });

  it("reads a page of rankings, leaving out what is no ranking", () => {
    expect(
      rankingsPageOf({ rankings: [{ uid: "a" }, 5, { uid: 7 }], nextCursor: "c" }),
    ).toMatchObject({ rankings: [{ uid: "a" }], nextCursor: "c" });
    expect(rankingsPageOf({ rankings: "x", nextCursor: "" })).toEqual({
      rankings: [],
      nextCursor: null,
    });
    expect(rankingsPageOf(undefined)).toEqual({ rankings: [], nextCursor: null });
  });

  it("asks for authors worth following", async () => {
    const { client, request } = recordingClient({ authors: [] });
    await expect(suggestedAuthors(client)).resolves.toEqual({ authors: [] });
    expect(request).toHaveBeenCalledWith("GET", "/lists/follow");
  });
});
