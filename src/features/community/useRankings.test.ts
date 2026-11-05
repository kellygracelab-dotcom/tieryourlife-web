import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { ApiFailure } from "../../api/errors";
import { PAGES_READ_ON, useRankings, type RankingsDeps } from "./useRankings";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const reader = (uid: string): ReaderRanking => ({
  uid,
  authorName: uid,
  authorPhotoUrl: null,
  arrangement: [0],
  rows: [[0]],
  tierLabels: [],
  updatedAtMs: 0,
  mine: false,
});

describe("useRankings", () => {
  it("reads on past a page that came back empty with more behind it", async () => {
    const pages: Record<string, RankingsPage> = {
      first: { rankings: [], nextCursor: "c1" },
      c1: { rankings: [], nextCursor: "c2" },
      c2: { rankings: [reader("kenji")], nextCursor: null },
    };
    const load = vi.fn(async (_list: string, after: string | null) => pages[after ?? "first"]!);
    const deps = { load, withdraw: vi.fn(async () => undefined) } as unknown as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.rankings.map((ranking) => ranking.uid)).toEqual(["kenji"]);
    expect(load.mock.calls.map((call) => call[1])).toEqual([null, "c1", "c2"]);
  });
  it("reads again from the top when the reader a page ended at is gone, keeping the rows", async () => {
    const load = vi.fn(async (_list: string, after: string | null): Promise<RankingsPage> => {
      if (after === null) return { rankings: [reader("a"), reader("b")], nextCursor: "b" };
      if (after === "b") throw new ApiFailure({ kind: "cursorGone" });
      return { rankings: [reader("c")], nextCursor: null };
    });
    const deps = { load, withdraw: vi.fn(async () => undefined) } as unknown as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // b withdrew: the top now ends at a, and the page after it brings c.
    load.mockImplementation(async (_list, after) =>
      after === null
        ? { rankings: [reader("a")], nextCursor: "a" }
        : after === "a"
          ? { rankings: [reader("c")], nextCursor: null }
          : Promise.reject(new ApiFailure({ kind: "cursorGone" })),
    );
    act(() => result.current.more());
    await waitFor(() => expect(result.current.state.next).toBeNull());
    expect(result.current.state.rankings.map((ranking) => ranking.uid)).toEqual(["a", "b", "c"]);
    expect(result.current.state.more).toBe("idle");
    expect(load.mock.calls.map((call) => call[1])).toEqual([null, "b", null, "a"]);
  });

  it("reads only a few empty pages on its own, never the same cursor twice, and no field is the end", async () => {
    const stuck = vi.fn(async (): Promise<RankingsPage> => ({ rankings: [], nextCursor: "s" }));
    const deps = { load: stuck, withdraw: vi.fn(async () => undefined) } as unknown as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // null, then "s" once: "s" again would never end.
    expect(stuck).toHaveBeenCalledTimes(2);
    expect(result.current.state.next).toBeNull();

    let n = 0;
    const endless = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [],
      nextCursor: `c${++n}`,
    }));
    const more = renderHook(() =>
      useRankings("l2", { load: endless, withdraw: vi.fn(async () => undefined) }),
    );
    act(() => more.result.current.open());
    await waitFor(() => expect(more.result.current.state.status).toBe("ready"));
    expect(endless).toHaveBeenCalledTimes(PAGES_READ_ON + 1);
    // Show more is offered again rather than read on for ever.
    expect(more.result.current.state.next).toBe(`c${PAGES_READ_ON + 1}`);

    const bare = vi.fn(async () => ({ rankings: [reader("a")] }) as unknown as RankingsPage);
    const old = renderHook(() =>
      useRankings("l3", { load: bare, withdraw: vi.fn(async () => undefined) }),
    );
    act(() => old.result.current.open());
    await waitFor(() => expect(old.result.current.state.status).toBe("ready"));
    expect(old.result.current.state.next).toBeNull();
  });

  it("lists a reader once when a page names them twice", async () => {
    const load = vi.fn(async (): Promise<RankingsPage> => ({
      rankings: [reader("a"), reader("b"), { ...reader("a"), authorName: "a again" }],
      nextCursor: null,
    }));
    const deps = { load, withdraw: vi.fn(async () => undefined) } as unknown as RankingsDeps;
    const { result } = renderHook(() => useRankings("l1", deps));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.rankings.map((ranking) => ranking.authorName)).toEqual(["a", "b"]);
  });
});
