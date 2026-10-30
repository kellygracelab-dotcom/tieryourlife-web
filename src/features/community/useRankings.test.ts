import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RankingsPage, ReaderRanking } from "../../api/community";
import { useRankings, type RankingsDeps } from "./useRankings";

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
});
