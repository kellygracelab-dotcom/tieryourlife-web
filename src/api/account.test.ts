import { describe, expect, it, vi } from "vitest";
import { eraseAccount, refreshAuthor } from "./account";
import type { ApiClient } from "./client";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("account", () => {
  it("asks the backend to put the fresh name and face on the published lists", async () => {
    const { client, request } = recordingClient({ updated: 3 });
    await expect(refreshAuthor(client)).resolves.toEqual({ updated: 3 });
    expect(request).toHaveBeenCalledWith("PATCH", "/lists");
  });

  it("ends the account through the boards function", async () => {
    const { client, request } = recordingClient(undefined);
    await expect(eraseAccount(client)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("DELETE", "/boards/account");
  });
});
