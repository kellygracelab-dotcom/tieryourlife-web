import { describe, expect, it, vi } from "vitest";
import { carryGuest, eraseMyAccount, refreshPublishedAuthor } from "./account";
import type { ApiClient } from "./client";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("account", () => {
  it("asks the backend to put the fresh name and face on the published lists", async () => {
    const { client, request } = recordingClient({ updated: 3 });
    await expect(refreshPublishedAuthor(client)).resolves.toEqual({ updated: 3 });
    expect(request).toHaveBeenCalledWith("PATCH", "/lists");
  });

  it("ends the account through the boards function", async () => {
    const { client, request } = recordingClient(undefined);
    await expect(eraseMyAccount(client)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("DELETE", "/boards/account");
  });
});

describe("carryGuest", () => {
  it("posts the guest's token to the proxy's adoption endpoint, same-origin", async () => {
    const request = vi.fn(async () => ({ credits: 3, moved: true }));
    const client = { request } as unknown as ApiClient;
    await expect(carryGuest(client, "guest.jwt")).resolves.toEqual({ credits: 3, moved: true });
    expect(request).toHaveBeenCalledWith("POST", "/adoptGuestCredits", {
      body: { guestToken: "guest.jwt" },
    });
  });
});
