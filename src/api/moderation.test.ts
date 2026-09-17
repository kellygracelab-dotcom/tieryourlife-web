import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { BAN_LENGTHS, dismissReports, getReports, takeDown } from "./moderation";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("moderation", () => {
  it("reads the queue", async () => {
    const { client, request } = recordingClient({ reports: [] });
    await expect(getReports(client)).resolves.toEqual({ reports: [] });
    expect(request).toHaveBeenCalledWith("GET", "/lists/reports");
  });

  it("takes a list down with or without a ban, and leaves one up", async () => {
    const { client, request } = recordingClient(undefined);
    await takeDown(client, "a b", "month");
    expect(request).toHaveBeenCalledWith("POST", "/lists/a%20b/takedown", {
      body: { ban: "month" },
    });
    await takeDown(client, "x", null);
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/x/takedown", { body: { ban: null } });
    await dismissReports(client, "x");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/x/dismiss");
    expect(BAN_LENGTHS).toEqual(["week", "month", "three_months", "six_months", "forever"]);
  });
});
