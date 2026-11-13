import { describe, expect, it, vi } from "vitest";
import {
  copiesOf,
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

  it("reads the copies a write is answered with, the catalogue address to ours", async () => {
    const tmdb = "https://image.tmdb.org/t/p/w500/x.jpg";
    const ours =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2Fcatalogue%2Fw-0123456789abcdef0123456789abcdef?alt=media";
    const { client } = recordingClient({ uid: "b", revision: 4, copies: { [tmdb]: ours } });
    const body = { fingerprint: "f", tiers: [], items: [] } as unknown as KeepBoardRequest;
    const answer = await keepBoard(client, "b", body);
    expect(answer.revision).toBe(4);
    expect([...(answer.copies ?? [])]).toEqual([[tmdb, ours]]);
  });

  it("reads copies with care: https to https only, none when nothing is left", () => {
    const ours =
      "https://firebasestorage.googleapis.com/v0/b/x/o/published%2Fcatalogue%2Fw-1?alt=media";
    expect(copiesOf(undefined)).toBeNull();
    expect(copiesOf(null)).toBeNull();
    expect(copiesOf([ours])).toBeNull();
    expect(copiesOf("copies")).toBeNull();
    expect(copiesOf({})).toBeNull();
    const read = copiesOf({
      "https://s4.anilist.co/a.png": ours,
      "http://image.tmdb.org/t/p/w500/x.jpg": ours,
      "https://image.tmdb.org/t/p/w500/y.jpg": "http://example.com/y.jpg",
      "https://image.tmdb.org/t/p/w500/z.jpg": 7,
      "https://image.tmdb.org/t/p/w500/same.jpg": "https://image.tmdb.org/t/p/w500/same.jpg",
      "https://image.tmdb.org/t/p/w500/js.jpg": "javascript:alert(1)",
      "not an address": ours,
    });
    expect(read === null ? null : [...read]).toEqual([["https://s4.anilist.co/a.png", ours]]);
  });

  it("answers a write without copies as before", async () => {
    const { client } = recordingClient({ uid: "b", revision: 2, copies: { x: "y" } });
    const body = { fingerprint: "f", tiers: [], items: [] } as unknown as KeepBoardRequest;
    await expect(keepBoard(client, "b", body)).resolves.toEqual({ uid: "b", revision: 2 });
  });

  it("hands back the board a refused write carries", () => {
    expect(parseApiError(409, JSON.stringify({ code: "CONFLICT", board: { uid: "x" } }))).toEqual({
      kind: "conflict",
      board: { uid: "x" },
    });
    expect(parseApiError(409, "{}")).toEqual({ kind: "conflict" });
  });
});
