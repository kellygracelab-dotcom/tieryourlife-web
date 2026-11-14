import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  claimKept,
  removeRanking,
  loadMyRankings,
  loadRanking,
  onceMoreWhenBusy,
  rearrangeRanking,
} from "./rank";
import { ApiFailure } from "./errors";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("rank", () => {
  it("cuts a reader's tier word to what the functions keep on a change", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh", claimToken: "t" });
    // 51 characters: the editors take up to 80, the functions refuse past 40.
    const long = "Films I would happily watch again every single year";
    const pair = `${"x".repeat(39)}\u{1F600}`;

    await rearrangeRanking(client, "abcdefgh", [[0], []], [long, " B "]);
    expect(request).toHaveBeenLastCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[0], []], tierLabels: ["Films I would happily watch again every", "B"] },
    });

    await rearrangeRanking(client, "abcdefgh", [[0], []], [pair, null]);
    expect(request).toHaveBeenLastCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[0], []], tierLabels: ["x".repeat(39), null] },
    });
  });

  it("reads a ranking by code with App Check alone", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });

    await expect(loadRanking(client, "abcdefgh")).resolves.toMatchObject({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("GET", "/api/rank/abcdefgh", { auth: "appCheckOnly" });
  });

  it("draws what it can of a ranking that came slightly wrong", async () => {
    const { client } = recordingClient({
      code: "abcdefgh",
      rows: null,
      snapshot: { title: "Films", authorName: null, tiers: [null], category: "film_tv" },
    });
    await expect(loadRanking(client, "abcdefgh")).resolves.toMatchObject({
      rows: [],
      snapshot: {
        title: "Films",
        authorName: "",
        tiers: [{ label: "", caption: null }],
        items: [],
      },
    });
  });

  it("reads a ranking as the account when asked, so the answer can call it yours", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh", yours: true });

    await expect(loadRanking(client, "abcdefgh", true)).resolves.toMatchObject({
      code: "abcdefgh",
      yours: true,
    });

    expect(request).toHaveBeenCalledWith("GET", "/api/rank/abcdefgh", {});
  });

  it("puts a new arrangement under the same code", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });
    const rows: readonly (readonly number[])[] = [[1], [0, 2]];

    await expect(rearrangeRanking(client, "abcdefgh", rows)).resolves.toEqual({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[1], [0, 2]] },
    });
    await rearrangeRanking(client, "abcdefgh", rows, [null, "Meh"]);
    expect(request).toHaveBeenLastCalledWith("PUT", "/api/rank/abcdefgh", {
      body: { rows: [[1], [0, 2]], tierLabels: [null, "Meh"] },
    });
  });

  it("takes a ranking away by its code, as the account", async () => {
    const { client, request } = recordingClient(undefined);
    await expect(removeRanking(client, "abcdefgh")).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("DELETE", "/api/rank/abcdefgh");
  });

  it("claims a ranking by code with the token Finish handed out", async () => {
    const { client, request } = recordingClient({ code: "abcdefgh" });

    await expect(claimKept(client, "abcdefgh", "t")).resolves.toEqual({ code: "abcdefgh" });

    expect(request).toHaveBeenCalledWith("PATCH", "/api/rank/abcdefgh", {
      body: { claimToken: "t" },
    });
  });

  it("lists the signed-in person's own rankings", async () => {
    const page = { rankings: [], more: false };
    const { client, request } = recordingClient(page);

    await expect(loadMyRankings(client)).resolves.toEqual(page);

    expect(request).toHaveBeenCalledWith("GET", "/api/me/rankings");
  });

  // QA S32: one save at a time per person; a quick second save waits the pause out once.
  describe("a save the server asks to wait", () => {
    const busy = () => new ApiFailure({ kind: "tooManyRequests", code: "BUSY" });

    it("is sent once more after the pause, and its answer is the answer", async () => {
      const save = vi
        .fn()
        .mockRejectedValueOnce(busy())
        .mockResolvedValueOnce({ code: "abcdefgh" });
      const wait = vi.fn(() => Promise.resolve());
      await expect(onceMoreWhenBusy(save, wait)).resolves.toEqual({ code: "abcdefgh" });
      expect(wait).toHaveBeenCalledWith(2000);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("is refused for good the second time, and anything else is not tried again", async () => {
      const wait = vi.fn(() => Promise.resolve());
      const twice = vi.fn().mockRejectedValue(busy());
      await expect(onceMoreWhenBusy(twice, wait)).rejects.toBeInstanceOf(ApiFailure);
      expect(twice).toHaveBeenCalledTimes(2);
      const other = new ApiFailure({ kind: "tooManyRequests", code: "TOO_MANY" });
      const once = vi.fn().mockRejectedValue(other);
      await expect(onceMoreWhenBusy(once, wait)).rejects.toBe(other);
      expect(once).toHaveBeenCalledTimes(1);
    });
  });
});
