import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { noteAdminDecision, useAdminCounts } from "./useAdminCounts";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

describe("useAdminCounts", () => {
  it("adds the open reports and the proposals the backend counts", async () => {
    const load = vi.fn(async () => ({ reports: 3, proposals: 4 }));
    const { result } = renderHook(() => useAdminCounts("u1", 1, load));
    await waitFor(() => expect(result.current).toBe(7));
  });

  it("falls back to the reports the menu holds when the backend has no count", async () => {
    const load = vi.fn(async () => Promise.reject(new Error("404")));
    const { result } = renderHook(() => useAdminCounts("u1", 2, load));
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(result.current).toBe(2);
  });

  it("asks again once a report or a proposal is decided, and the count falls", async () => {
    let waiting = { reports: 3, proposals: 1 };
    const load = vi.fn(async () => waiting);
    const { result } = renderHook(() => useAdminCounts("u1", 3, load));
    await waitFor(() => expect(result.current).toBe(4));
    waiting = { reports: 0, proposals: 0 };
    act(() => noteAdminDecision());
    await waitFor(() => expect(result.current).toBe(0));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("asks nothing for somebody who is not an admin", () => {
    const load = vi.fn(async () => ({ reports: 9, proposals: 9 }));
    const { result } = renderHook(() => useAdminCounts(null, 0, load));
    expect(result.current).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });
});
