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

import { api, keepRanking, loadList, loadRanking, noteTake } from "./api";

describe("api", () => {
  it("is one client built on the Firebase token providers", () => {
    expect(api.request).toBe(mocks.request);
  });

  it("loads a list through that client", async () => {
    await expect(loadList("abc")).resolves.toEqual({ id: "abc" });
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists/abc");
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

  it("notes a take and swallows a refusal", async () => {
    await expect(noteTake("abc")).resolves.toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith("POST", "/lists/abc/taken");
    mocks.request.mockRejectedValueOnce(new Error("down"));
    await expect(noteTake("abc")).resolves.toBeUndefined();
  });
});
