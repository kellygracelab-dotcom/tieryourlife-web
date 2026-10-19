import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_GRAB, type DragState } from "./drag";
import { EDGE_SPEED, EDGE_ZONE, edgeSpeed, useFixedDock, type DockEnv } from "./useFixedDock";

/** Observers that do nothing until the test says what they see. */
function fakeEnv() {
  const resized: Array<() => void> = [];
  const crossed: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
  const margins: string[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const env: DockEnv = {
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver,
    IntersectionObserver: class {
      constructor(
        callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        options: { rootMargin: string },
      ) {
        crossed.push(callback);
        margins.push(options.rootMargin);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver,
    requestAnimationFrame: (tick) => {
      frames.set(nextFrame, tick);
      return nextFrame++;
    },
    cancelAnimationFrame: (frame) => void frames.delete(frame),
  };
  /** Runs the frames that are waiting, once each. */
  const step = () => {
    const waiting = [...frames];
    frames.clear();
    for (const [, tick] of waiting) tick(0);
  };
  return { env, resized, crossed, margins, frames, step };
}

function dockElement(top = 600, height = 120): HTMLElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  Object.defineProperty(el, "offsetHeight", { configurable: true, value: height });
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.append(el);
  return el;
}

let scrollY = 0;
beforeEach(() => {
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  window.scrollBy = vi.fn((_x: number | ScrollToOptions, y?: number) => {
    scrollY += y ?? 0;
  }) as typeof window.scrollBy;
});
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("--dock-h");
});

const dragging = (y: number): DragState => ({
  phase: "dragging",
  item: 0,
  at: { x: 10, y },
  target: null,
  grab: NO_GRAB,
});

describe("edgeSpeed", () => {
  it("is nothing at the band's inner side, the most at the edge, and stays in between", () => {
    expect(edgeSpeed(0)).toBe(0);
    expect(edgeSpeed(1)).toBe(EDGE_SPEED);
    expect(edgeSpeed(0.5)).toBe(EDGE_SPEED / 4);
    expect(edgeSpeed(-1)).toBe(0);
    expect(edgeSpeed(3)).toBe(EDGE_SPEED);
  });
});

describe("useFixedDock", () => {
  it("writes its height to the root while fixed, and takes it away after", () => {
    const fake = fakeEnv();
    const poolBox = { current: dockElement(600, 120) };
    const { unmount, rerender } = renderHook(
      ({ fixed }) =>
        useFixedDock({
          poolBox,
          boardEnd: { current: document.createElement("div") },
          fixed,
          dragging: false,
          dragNow: () => ({ phase: "idle" }),
          nudge: () => undefined,
          env: fake.env,
        }),
      { initialProps: { fixed: true } },
    );
    act(() => fake.resized[0]?.());
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("120px");

    rerender({ fixed: false });
    expect(document.documentElement.style.getPropertyValue("--dock-h")).toBe("");
    unmount();
  });

  it("keeps the last row in place when the dock grows while the page is at its end", () => {
    const fake = fakeEnv();
    const el = dockElement(600, 100);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    renderHook(() =>
      useFixedDock({
        poolBox: { current: el },
        boardEnd: { current: document.createElement("div") },
        fixed: true,
        dragging: false,
        dragNow: () => ({ phase: "idle" }),
        nudge: () => undefined,
        env: fake.env,
      }),
    );
    act(() => fake.resized[0]?.());
    expect(window.scrollBy).not.toHaveBeenCalled();
    Object.defineProperty(el, "offsetHeight", { configurable: true, value: 160 });
    act(() => fake.resized[0]?.());
    expect(window.scrollBy).toHaveBeenCalledWith(0, 60);
  });

  it("says a row is under the dock while the board's end is out of sight above it", () => {
    const fake = fakeEnv();
    const { result } = renderHook(() =>
      useFixedDock({
        poolBox: { current: dockElement(600, 120) },
        boardEnd: { current: document.createElement("div") },
        fixed: true,
        dragging: false,
        dragNow: () => ({ phase: "idle" }),
        nudge: () => undefined,
        env: fake.env,
      }),
    );
    expect(result.current.over).toBe(false);
    act(() => fake.resized[0]?.());
    // Watched against the window above the dock, once its height is known.
    expect(fake.margins.at(-1)).toBe("0px 0px -120px 0px");
    act(() => fake.crossed.at(-1)?.([{ isIntersecting: false }]));
    expect(result.current.over).toBe(true);
    act(() => fake.crossed.at(-1)?.([{ isIntersecting: true }]));
    expect(result.current.over).toBe(false);
  });

  it("is never over anything while it is not fixed", () => {
    const fake = fakeEnv();
    const { result } = renderHook(() =>
      useFixedDock({
        poolBox: { current: dockElement() },
        boardEnd: { current: document.createElement("div") },
        fixed: false,
        dragging: false,
        dragNow: () => ({ phase: "idle" }),
        nudge: () => undefined,
        env: fake.env,
      }),
    );
    expect(fake.resized).toHaveLength(0);
    expect(fake.crossed).toHaveLength(0);
    expect(result.current.over).toBe(false);
  });

  it("scrolls down in the band above the dock, up under the header, and not in between", () => {
    const fake = fakeEnv();
    const nudge = vi.fn();
    let now = dragging(600 - EDGE_ZONE / 2);
    const { rerender } = renderHook(
      ({ on }) =>
        useFixedDock({
          poolBox: { current: dockElement(600) },
          boardEnd: { current: document.createElement("div") },
          fixed: true,
          dragging: on,
          dragNow: () => now,
          nudge,
          env: fake.env,
        }),
      { initialProps: { on: true } },
    );

    fake.step();
    expect(window.scrollBy).toHaveBeenLastCalledWith(0, edgeSpeed(0.5));
    // The page moved under the pointer: what is under it is read again.
    expect(nudge).toHaveBeenCalledTimes(1);

    now = dragging(EDGE_ZONE / 4);
    fake.step();
    expect(window.scrollBy).toHaveBeenLastCalledWith(0, -edgeSpeed(0.75));

    vi.mocked(window.scrollBy).mockClear();
    now = dragging(300);
    fake.step();
    expect(window.scrollBy).not.toHaveBeenCalled();

    // The drag ends: the loop stops for good.
    rerender({ on: false });
    expect(fake.frames.size).toBe(0);
  });

  it("does not scroll for a pool that is not fixed to the window, the tray on a phone", () => {
    const fake = fakeEnv();
    const el = dockElement(600);
    el.style.position = "static";
    renderHook(() =>
      useFixedDock({
        poolBox: { current: el },
        boardEnd: { current: document.createElement("div") },
        fixed: true,
        dragging: true,
        dragNow: () => dragging(590),
        nudge: () => undefined,
        env: fake.env,
      }),
    );
    expect(fake.frames.size).toBe(0);
  });
});
