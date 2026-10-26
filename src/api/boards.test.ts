import { describe, expect, it, vi } from "vitest";
import {
  forgetBoard,
  keepBoard,
  loadBoardIndex,
  loadKeptBoard,
  type KeepBoardRequest,
} from "./boards";
import type { ApiClient } from "./client";
import { parseApiError } from "./errors";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("boards", () => {
  it("reads the index, page by page", async () => {
    const { client, request } = recordingClient({ boards: [], next: null });
    await loadBoardIndex(client);
    expect(request).toHaveBeenCalledWith("GET", "/boards", { query: {} });
    await loadBoardIndex(client, "abc");
    expect(request).toHaveBeenLastCalledWith("GET", "/boards", { query: { after: "abc" } });
  });

  it("reads, writes and forgets one board by uid, escaping the uid", async () => {
    const { client, request } = recordingClient({ uid: "a b", revision: 2 });
    await loadKeptBoard(client, "a b");
    expect(request).toHaveBeenCalledWith("GET", "/boards/a%20b");
    const body = {
      basedOn: 1,
      fingerprint: "f",
      tiers: [],
      items: [],
    } as unknown as KeepBoardRequest;
    await expect(keepBoard(client, "a b", body)).resolves.toEqual({ uid: "a b", revision: 2 });
    expect(request).toHaveBeenLastCalledWith("PUT", "/boards/a%20b", { body });
    await forgetBoard(client, "a/b");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/boards/a%2Fb");
  });

  it("hands back the board a refused write carries", () => {
    expect(parseApiError(409, JSON.stringify({ code: "CONFLICT", board: { uid: "x" } }))).toEqual({
      kind: "conflict",
      board: { uid: "x" },
    });
    expect(parseApiError(409, "{}")).toEqual({ kind: "conflict" });
  });
});
