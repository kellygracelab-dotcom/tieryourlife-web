import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { adoptGuest } from "./guest";

describe("adoptGuest", () => {
  it("posts the guest's token to the proxy's adoption endpoint, same-origin", async () => {
    const request = vi.fn(async () => ({ credits: 3, moved: true }));
    const client = { request } as unknown as ApiClient;
    await expect(adoptGuest(client, "guest.jwt")).resolves.toEqual({ credits: 3, moved: true });
    expect(request).toHaveBeenCalledWith("POST", "/adoptGuestCredits", {
      body: { guestToken: "guest.jwt" },
    });
  });
});
