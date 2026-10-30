import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const request = vi.fn(async () => ({ id: "abc" }));
  return {
    request,
    createApiClient: vi.fn(() => ({ request })),
    tokenProviders: { appCheckToken: vi.fn(), idToken: vi.fn() },
  };
});

vi.mock("../api/client", () => ({ createApiClient: mocks.createApiClient }));
vi.mock("./firebase", () => ({ tokenProviders: mocks.tokenProviders }));
vi.mock("./preload", () => ({
  preloadedList: (id: string) =>
    id === "embedded" ? { id: "embedded", title: "From HTML" } : null,
  preloadedRanking: (code: string) => (code === "embedded" ? { code: "embedded" } : null),
}));

import {
  api,
  carryGuest,
  claimKept,
  eraseMyAccount,
  followAuthor,
  followState,
  keepListRanking,
  keepRanking,
  leaveListUp,
  loadFeed,
  loadList,
  loadListRankings,
  loadMyLists,
  loadMyRankings,
  loadRanking,
  loadReports,
  noteTake,
  findInCatalogue,
  publish,
  rearrangeRanking,
  refreshPublishedAuthor,
  removeRanking,
  report,
  republish,
  suggestedAuthors,
  takeDownList,
  unfollowAuthor,
  unpublish,
  withdrawListRanking,
} from "./api";

describe("api", () => {
  it("is one client built on the Firebase token providers", () => {
    expect(api.request).toBe(mocks.request);
  });

  it("loads a list through that client", async () => {
    await expect(loadList("abc")).resolves.toMatchObject({ id: "abc" });
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists/abc");
  });

  it("takes what the page already carries without asking the network", async () => {
    mocks.request.mockClear();
    await expect(loadList("embedded")).resolves.toMatchObject({
      id: "embedded",
      title: "From HTML",
    });
    await expect(loadRanking("embedded")).resolves.toEqual({ code: "embedded" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("loads a page of the feed for a query", async () => {
    await loadFeed({ category: "anime", sort: "popular" });
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists", {
      query: { category: "anime", sort: "popular" },
    });
  });

  it("asks the network for an embedded ranking when an account wants to know if it is theirs", async () => {
    mocks.request.mockClear();
    await loadRanking("embedded", true);
    expect(mocks.request).toHaveBeenCalledWith("GET", "/api/rank/embedded", {});
  });

  it("puts a new arrangement under the same code", async () => {
    await rearrangeRanking("abcdefgh", [[0], [1]]);
    expect(mocks.request).toHaveBeenCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[0], [1]] },
    });
  });

  it("loads a ranking and keeps one", async () => {
    await loadRanking("abcdefgh");
    expect(mocks.request).toHaveBeenCalledWith("GET", "/api/rank/abcdefgh", {
      auth: "appCheckOnly",
    });
    await keepRanking("abc", [[1], []]);
    expect(mocks.request).toHaveBeenCalledWith("POST", "/api/rank", {
      body: { listId: "abc", rows: [[1], []] },
    });
  });

  it("puts a reader's finished placing among the list's rankings as rows, one per tier", async () => {
    const tier = { caption: null, colorLight: "#b03a32", colorDark: "#f1948c" };
    const list = {
      id: "abc",
      tiers: [
        { label: "S", ...tier },
        { label: "A", ...tier },
      ],
      items: [
        { title: "Ex Machina", imageUrl: null, tierIndex: null },
        { title: "The Witch", imageUrl: null, tierIndex: null },
      ],
    };
    await keepListRanking(list, [[1, 0, 5]]);
    expect(mocks.request).toHaveBeenCalledWith("PUT", "/lists/abc/rankings/mine", {
      body: { tierLabels: ["S", "A"], rows: [[1, 0], []] },
    });
  });

  it("carries a guest over to the account that was signed into instead", async () => {
    await carryGuest("guest.jwt");
    expect(mocks.request).toHaveBeenCalledWith("POST", "/adoptGuestCredits", {
      body: { guestToken: "guest.jwt" },
    });
  });

  it("claims a kept ranking and lists the account's rankings", async () => {
    await claimKept("abcdefgh", "secret");
    expect(mocks.request).toHaveBeenCalledWith("PATCH", "/api/rank/abcdefgh", {
      body: { claimToken: "secret" },
    });
    await loadMyRankings();
    expect(mocks.request).toHaveBeenCalledWith("GET", "/api/me/rankings");
    await loadMyLists();
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists/mine");
  });

  it("searches the catalogue and publishes a list through the same client", async () => {
    mocks.request.mockResolvedValueOnce({ results: [] } as unknown as { id: string });
    await expect(findInCatalogue("ghibli")).resolves.toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith("GET", "/3/search/multi", {
      query: { query: "ghibli", include_adult: false, language: "en-US", page: 1 },
      auth: "appCheckOnly",
    });
    const request = {
      title: "T",
      category: "anime" as const,
      coverImageUrl: null,
      coverPictureId: null,
      tiers: [],
      items: [],
    };
    await publish(request);
    expect(mocks.request).toHaveBeenCalledWith("POST", "/lists", { body: request });
  });

  it("notes a take and swallows a refusal", async () => {
    await expect(noteTake("abc")).resolves.toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith("POST", "/lists/abc/taken");
    mocks.request.mockRejectedValueOnce(new Error("down"));
    await expect(noteTake("abc")).resolves.toBeUndefined();
  });

  // Each of these only binds the client; the request itself is tested in api/.
  it.each([
    ["removeRanking", () => removeRanking("abcdefgh"), "DELETE", "/api/rank/abcdefgh"],
    ["republish", () => republish("abc", { title: "T" } as never), "POST", "/lists/abc"],
    ["unpublish", () => unpublish("abc"), "DELETE", "/lists/abc"],
    ["refreshPublishedAuthor", () => refreshPublishedAuthor(), "PATCH", "/lists"],
    ["report", () => report("abc", { reason: "spam", note: null }), "POST", "/lists/abc/report"],
    ["loadReports", () => loadReports(), "GET", "/lists/reports"],
    ["followState", () => followState("u1"), "GET", "/lists/follow/u1"],
    ["followAuthor", () => followAuthor("u1"), "POST", "/lists/follow/u1"],
    ["unfollowAuthor", () => unfollowAuthor("u1"), "DELETE", "/lists/follow/u1"],
    ["suggestedAuthors", () => suggestedAuthors(), "GET", "/lists/follow"],
    ["loadListRankings", () => loadListRankings("abc"), "GET", "/lists/abc/rankings"],
    ["withdrawListRanking", () => withdrawListRanking("abc"), "DELETE", "/lists/abc/rankings/mine"],
    ["takeDownList", () => takeDownList("abc", "week"), "POST", "/lists/abc/takedown"],
    ["leaveListUp", () => leaveListUp("abc"), "POST", "/lists/abc/dismiss"],
    ["eraseMyAccount", () => eraseMyAccount(), "DELETE", "/boards/account"],
  ] as const)("%s goes through the one client", async (_, call, method, path) => {
    mocks.request.mockClear();
    await call();
    const [sent, to] = (mocks.request.mock.calls[0] ?? []) as unknown[];
    expect(sent).toBe(method);
    expect(to).toBe(path);
  });
});
