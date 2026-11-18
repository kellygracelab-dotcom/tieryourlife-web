import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { colourChoiceOf, keepColourSetting, loadColourSetting } from "./settings";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("the account's colour", () => {
  it("reads the account's choice, and none when it never chose", async () => {
    const chosen = { name: "sky", hue: 212, changedAt: 5, updatedAt: 6 };
    const { client, request } = recordingClient({ colour: chosen });
    await expect(loadColourSetting(client)).resolves.toEqual({
      name: "sky",
      hue: 212,
      changedAt: 5,
    });
    expect(request).toHaveBeenCalledWith("GET", "/boards/settings");

    await expect(loadColourSetting(recordingClient({ colour: null }).client)).resolves.toBeNull();
    await expect(loadColourSetting(recordingClient({}).client)).resolves.toBeNull();
  });

  it("keeps a name it does not know, and drops a hue out of the circle", () => {
    expect(colourChoiceOf({ name: "neon", hue: 400, changedAt: 1 })).toEqual({
      name: "neon",
      hue: null,
      changedAt: 1,
    });
    expect(colourChoiceOf({ name: "", hue: 1, changedAt: 1 })).toBeNull();
    expect(colourChoiceOf({ name: "sky", hue: 1, changedAt: 0 })).toBeNull();
    expect(colourChoiceOf([])).toBeNull();
  });

  it("writes a choice with its hue, and without one when there is none", async () => {
    const { client, request } = recordingClient({ name: "custom", hue: 30, changedAt: 9 });
    await expect(
      keepColourSetting(client, { name: "custom", hue: 30, changedAt: 9 }),
    ).resolves.toEqual({ kept: { name: "custom", hue: 30, changedAt: 9 }, landed: true });
    expect(request).toHaveBeenCalledWith("PUT", "/boards/settings/colour", {
      body: { name: "custom", hue: 30, changedAt: 9 },
    });

    const bare = recordingClient({ name: "matcha", changedAt: 3 });
    await keepColourSetting(bare.client, { name: "matcha", hue: null, changedAt: 3 });
    expect(bare.request).toHaveBeenCalledWith("PUT", "/boards/settings/colour", {
      body: { name: "matcha", changedAt: 3 },
    });
  });

  it("answers an earlier write with what the account keeps", async () => {
    const { client } = recordingClient({ name: "peach", hue: null, changedAt: 20, landed: false });
    await expect(
      keepColourSetting(client, { name: "sky", hue: null, changedAt: 10 }),
    ).resolves.toEqual({ kept: { name: "peach", hue: null, changedAt: 20 }, landed: false });
  });
});
