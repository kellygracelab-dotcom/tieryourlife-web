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
  keepRanking,
  loadFeed,
  loadList,
  loadMyRankings,
  loadRanking,
  noteTake,
  rearrangeRanking,
} from "./api";

describe("api", () => {
  it("is one client built on the Firebase token providers", () => {
    expect(api.request).toBe(mocks.request);
  });

  it("loads a list through that client", async () => {
    await expect(loadList("abc")).resolves.toEqual({ id: "abc" });
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists/abc");
  });

  it("takes what the page already carries without asking the network", async () => {
    mocks.request.mockClear();
    await expect(loadList("embedded")).resolves.toEqual({ id: "embedded", title: "From HTML" });
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
  });

  it("notes a take and swallows a refusal", async () => {
    await expect(noteTake("abc")).resolves.toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith("POST", "/lists/abc/taken");
    mocks.request.mockRejectedValueOnce(new Error("down"));
    await expect(noteTake("abc")).resolves.toBeUndefined();
  });
});
