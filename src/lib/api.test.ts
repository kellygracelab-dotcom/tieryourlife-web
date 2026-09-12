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

import { api, loadList } from "./api";

describe("api", () => {
  it("is one client built on the Firebase token providers", () => {
    expect(api.request).toBe(mocks.request);
  });

  it("loads a list through that client", async () => {
    await expect(loadList("abc")).resolves.toEqual({ id: "abc" });
    expect(mocks.request).toHaveBeenCalledWith("GET", "/lists/abc");
  });
});
