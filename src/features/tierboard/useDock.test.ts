import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryStore } from "../../lib/storage";
import { useDock, WIDE_BOARD_FROM } from "./useDock";

const windowOf = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

beforeEach(() => windowOf(1600, 1000));

/** A grip the test moves by hand: pointer events on it, as the browser would send them. */
function grab(startY: number) {
  const grip = document.createElement("div");
  grip.setPointerCapture = () => undefined;
  const event = { currentTarget: grip, clientY: startY, pointerId: 1 };
  const moveTo = (clientY: number) =>
    grip.dispatchEvent(Object.assign(new Event("pointermove"), { clientY }));
  const release = () => grip.dispatchEvent(new Event("pointerup"));
  return { event: event as unknown as ReactPointerEvent<HTMLElement>, moveTo, release };
}

describe("useDock", () => {
  it("is wide from the board's breakpoint, and narrow under it", () => {
    windowOf(WIDE_BOARD_FROM - 1, 1000);
    expect(renderHook(() => useDock(memoryStore())).result.current.wide).toBe(false);
    windowOf(WIDE_BOARD_FROM, 1000);
    expect(renderHook(() => useDock(memoryStore())).result.current.wide).toBe(true);
  });

  it("grows a row for every hundred pixels the grip goes up, and keeps the choice", () => {
    const store = memoryStore();
    const { result } = renderHook(() => useDock(store));
    act(() => result.current.choose("under"));
    const start = result.current.rows;
    const grip = grab(500);

    act(() => result.current.startResize(grip.event));
    act(() => grip.moveTo(400));
    expect(result.current.rows).toBe(start + 1);
    act(() => grip.moveTo(560));
    expect(result.current.rows).toBe(Math.max(1, start - 1));
    act(() => grip.release());
    // Released: the grip no longer moves anything.
    act(() => grip.moveTo(0));
    expect(result.current.rows).toBe(Math.max(1, start - 1));
    expect(renderHook(() => useDock(store)).result.current.rows).toBe(Math.max(1, start - 1));
  });

  it("never shows fewer than one row or more than the window has room for", () => {
    const { result } = renderHook(() => useDock(memoryStore()));
    const grip = grab(500);
    act(() => result.current.startResize(grip.event));
    act(() => grip.moveTo(5000));
    expect(result.current.rows).toBe(1);
    act(() => grip.moveTo(-5000));
    const most = result.current.rows;
    act(() => grip.moveTo(-9000));
    expect(result.current.rows).toBe(most);
    expect(most).toBeGreaterThan(1);
  });
});
