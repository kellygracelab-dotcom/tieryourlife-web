import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { claimRanking, getMyRankings, getRanking, saveRanking, updateRanking } from "./rank";

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

  it("reads a ranking as the account when asked, so the answer can call it yours", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh", yours: true });

    await expect(getRanking(client, "abcdefgh", true)).resolves.toEqual({
      code: "abcdefgh",
      yours: true,
    });

    expect(request).toHaveBeenCalledWith("GET", "/api/rank/abcdefgh", {});
  });

  it("puts a new arrangement under the same code", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });
    const rows: readonly (readonly number[])[] = [[1], [0, 2]];

    await expect(updateRanking(client, "abcdefgh", rows)).resolves.toEqual({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[1], [0, 2]] },
    });
  });

  it("claims a ranking by code with the token Finish handed out", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });

    await expect(claimRanking(client, "abcdefgh", "t")).resolves.toEqual({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("PATCH", "/api/rank/abcdefgh", {
      body: { claimToken: "t" },
    });
  });

  it("lists the signed-in person's own rankings", async () => {
    const page = { rankings: [], more: false };
    const { client, request } = recordingClient(page);

    await expect(getMyRankings(client)).resolves.toEqual(page);

    expect(request).toHaveBeenCalledWith("GET", "/api/me/rankings");
  });
});
