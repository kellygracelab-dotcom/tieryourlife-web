import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api/errors";
import type { PublishedList } from "../api/types";
import { useResource } from "./useResource";

const list = { id: "abc", title: "Films" } as PublishedList;

describe("useResource", () => {
  it("starts loading and settles on what it loaded", async () => {
    const load = vi.fn(async () => list);
    const { result } = renderHook(() => useResource("abc", load));

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: list }));
    expect(load).toHaveBeenCalledWith("abc");
  });

  it("keeps the API's refusal and can try again", async () => {
    const load = vi
      .fn<() => Promise<PublishedList>>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce(list);
    const { result } = renderHook(() => useResource("abc", load));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "error", error: { kind: "offline" } }),
    );
    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: list }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports anything that is not an API failure as unknown", async () => {
    const load = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useResource("abc", load));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: { kind: "unknown", status: 0 },
      }),
    );
  });

  it("ignores an answer that arrives after the key changed", async () => {
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
    const { result, rerender } = renderHook(({ id }) => useResource(id, load), {
      initialProps: { id: "abc" },
    });

    rerender({ id: "def" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", value: { ...list, id: "def" } }),
    );
    act(() => resolveFirst({ ...list, id: "abc" }));
    expect(result.current.state).toEqual({ status: "ready", value: { ...list, id: "def" } });
  });
  it("draws a value at hand at once and still loads the fresh one", async () => {
    const fresh = { ...list, title: "Films, fresher" };
    const load = vi.fn(async () => fresh);
    const { result } = renderHook(() => useResource("abc", load, undefined, { peek: () => list }));

    expect(result.current.state).toEqual({ status: "ready", value: list });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: fresh }));
  });

  it("keeps the shown value while another key of its group loads", async () => {
    let answer: (value: PublishedList) => void = () => undefined;
    const load = vi
      .fn<(key: string) => Promise<PublishedList>>()
      .mockResolvedValueOnce(list)
      .mockImplementationOnce(
        () =>
          new Promise<PublishedList>((resolve) => {
            answer = resolve;
          }),
      );
    const { result, rerender } = renderHook(
      ({ key, group }) => useResource(key, load, undefined, { group }),
      { initialProps: { key: "abc|guest", group: "abc" } },
    );
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: list }));

    rerender({ key: "abc|u1", group: "abc" });
    expect(result.current.state).toEqual({ status: "ready", value: list });
    const theirs = { ...list, title: "Films, as u1 sees them" };
    act(() => answer(theirs));
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: theirs }));
  });

  it("does not keep a value for a key of another group", async () => {
    const load = vi
      .fn<(key: string) => Promise<PublishedList>>()
      .mockResolvedValueOnce(list)
      .mockImplementationOnce(() => new Promise<PublishedList>(() => undefined));
    const { result, rerender } = renderHook(
      ({ key }) => useResource(key, load, undefined, { group: key }),
      { initialProps: { key: "abc" } },
    );
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", value: list }));

    rerender({ key: "def" });
    expect(result.current.state).toEqual({ status: "loading" });
  });
});
