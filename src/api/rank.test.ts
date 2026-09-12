import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { getRanking, saveRanking } from "./rank";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("rank", () => {
  it("saves the rows of a ranking as plain arrays with the caller's tokens", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh", claimToken: "t" });
    const rows: readonly (readonly number[])[] = [[2, 0], []];

    await expect(saveRanking(client, "wMRMFDxo8UejcAi2VVMW", rows)).resolves.toEqual({
      code: "abcdefgh",
      claimToken: "t",
    });

    expect(request).toHaveBeenCalledWith("POST", "/api/rank", {
      body: { listId: "wMRMFDxo8UejcAi2VVMW", rows: [[2, 0], []] },
    });
  });

  it("reads a ranking by code with App Check alone", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });

    await expect(getRanking(client, "abcdefgh")).resolves.toEqual({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("GET", "/api/rank/abcdefgh", { auth: "appCheckOnly" });
  });
});
