import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { useList } from "./useList";

vi.mock("../../lib/api", () => ({ loadList: vi.fn() }));

const list = { id: "abc", title: "Films" } as PublishedList;

describe("useList", () => {
  it("starts loading and settles on the list", async () => {
    const load = vi.fn(async () => list);
    const { result } = renderHook(() => useList("abc", load));

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", list }));
    expect(load).toHaveBeenCalledWith("abc");
  });

  it("keeps the proxy's refusal and can try again", async () => {
    const load = vi
      .fn<() => Promise<PublishedList>>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce(list);
    const { result } = renderHook(() => useList("abc", load));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "error", error: { kind: "offline" } }),
    );
    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", list }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports anything that is not an API failure as unknown", async () => {
    const load = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useList("abc", load));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: { kind: "unknown", status: 0 },
      }),
    );
  });

  it("ignores an answer that arrives after the id changed", async () => {
    let resolveFirst: (value: PublishedList) => void = () => undefined;
    const load = vi
      .fn<(id: string) => Promise<PublishedList>>()
      .mockImplementationOnce(
        () =>
          new Promise<PublishedList>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...list, id: "def" });
    const { result, rerender } = renderHook(({ id }) => useList(id, load), {
      initialProps: { id: "abc" },
    });

    rerender({ id: "def" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", list: { ...list, id: "def" } }),
    );
    act(() => resolveFirst({ ...list, id: "abc" }));
    expect(result.current.state).toEqual({ status: "ready", list: { ...list, id: "def" } });
  });
});
