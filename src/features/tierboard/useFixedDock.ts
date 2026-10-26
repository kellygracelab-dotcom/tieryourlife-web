import { useEffect, useState, type RefObject } from "react";
import type { DragState } from "./drag";

/** The band above the dock's edge, and under the header, where a dragged card scrolls the page. */
export const EDGE_ZONE = 56;
/** The most the page moves per frame, at the very edge. */
export const EDGE_SPEED = 14;
/** Faster toward the edge: depth 0 at the band's inner side, 1 at the edge. */
export const edgeSpeed = (depth: number): number =>
  EDGE_SPEED * Math.min(1, Math.max(0, depth)) ** 2;

/** The browser's pieces the dock watches with; jsdom has none of them, a test hands in fakes. */
export interface DockEnv {
  ResizeObserver?: typeof ResizeObserver;
  IntersectionObserver?: typeof IntersectionObserver;
  requestAnimationFrame?: (tick: FrameRequestCallback) => number;
  cancelAnimationFrame?: (frame: number) => void;
}

// Read once: the effects below depend on these, and a fresh binding every
// render would restart the scroll loop on every pointer move.
const BROWSER: DockEnv = {
  ResizeObserver: globalThis.ResizeObserver,
  IntersectionObserver: globalThis.IntersectionObserver,
  requestAnimationFrame:
    typeof requestAnimationFrame === "function" ? (tick) => requestAnimationFrame(tick) : undefined,
  cancelAnimationFrame:
    typeof cancelAnimationFrame === "function" ? (frame) => cancelAnimationFrame(frame) : undefined,
};

interface FixedDockOptions {
  /** The dock: the pool fixed to the window's foot. */
  poolBox: RefObject<HTMLElement | null>;
  /** A sentinel at the board's end. */
  boardEnd: RefObject<HTMLElement | null>;
  /** Whether the dock is fixed at all; under the board on a wide screen, with cards left. */
  fixed: boolean;
  dragging: boolean;
  /** The drag as it is now, read every frame without waiting for a render. */
  dragNow: () => DragState;
  /** Reads again what is under the pointer after the page moved under it. */
  nudge: () => void;
  env?: DockEnv;
}

/**
 * What a dock fixed to the window's foot owes the page around it: its height
 * as --dock-h on the root, so the page leaves room under the board; whether a
 * row is hidden under it, for its shadow; and a page that scrolls when a card
 * is dragged toward a row the dock covers.
 */
export function useFixedDock({
  poolBox,
  boardEnd,
  fixed,
  dragging,
  dragNow,
  nudge,
  env = BROWSER,
}: FixedDockOptions): { over: boolean } {
  const { ResizeObserver: Resize, IntersectionObserver: Intersection } = env;
  const { requestAnimationFrame: nextFrame, cancelAnimationFrame: cancelFrame } = env;

  // The page's padding, its scroll padding and the snackbar follow --dock-h.
  // Resized while the page is at its end, the last row keeps its place
  // against the dock instead of jumping under it.
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    const el = poolBox.current;
    if (!fixed || el === null || Resize === undefined) return;
    const root = document.documentElement;
    let last = 0;
    const observer = new Resize(() => {
      const height = el.offsetHeight;
      if (height === last) return;
      const atEnd = window.scrollY + window.innerHeight >= root.scrollHeight - 1;
      root.style.setProperty("--dock-h", `${height}px`);
      if (atEnd && last > 0 && height > last) window.scrollBy(0, height - last);
      last = height;
      setDockHeight(height);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--dock-h");
    };
  }, [fixed, poolBox, Resize]);

  // The sentinel at the board's end is watched against the window above the
  // dock: hidden, a row is under the dock; showing, the board has ended.
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const end = boardEnd.current;
    if (!fixed || end === null || Intersection === undefined) return;
    const observer = new Intersection(([entry]) => setCovered(!(entry?.isIntersecting ?? true)), {
      rootMargin: `0px 0px -${dockHeight}px 0px`,
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [fixed, dockHeight, boardEnd, Intersection]);

  // A band above the dock's edge scrolls down, one under the header scrolls
  // up, faster toward the edge; what is under the pointer is read again after
  // each step so the drop lands where the pointer is.
  useEffect(() => {
    const el = poolBox.current;
    if (!dragging || el === null || nextFrame === undefined || cancelFrame === undefined) return;
    if (getComputedStyle(el).position !== "fixed") return;
    const bar = document.querySelector<HTMLElement>(".top");
    const head = document.querySelector<HTMLElement>(".list-head");
    const topEdge = () =>
      Math.max(
        bar?.getBoundingClientRect().bottom ?? 0,
        head !== null && getComputedStyle(head).position === "sticky"
          ? head.getBoundingClientRect().bottom
          : 0,
      );
    let frame = 0;
    const tick = () => {
      const now = dragNow();
      if (now.phase === "dragging") {
        const y = now.at.y;
        const bottom = el.getBoundingClientRect().top;
        const top = topEdge();
        let speed = 0;
        if (y < bottom && y >= bottom - EDGE_ZONE) {
          speed = edgeSpeed((y - (bottom - EDGE_ZONE)) / EDGE_ZONE);
        } else if (y <= top + EDGE_ZONE) {
          speed = -edgeSpeed((top + EDGE_ZONE - y) / EDGE_ZONE);
        }
        if (speed !== 0) {
          const before = window.scrollY;
          window.scrollBy(0, speed);
          if (window.scrollY !== before) nudge();
        }
      }
      frame = nextFrame(tick);
    };
    frame = nextFrame(tick);
    return () => cancelFrame(frame);
  }, [dragging, dragNow, nudge, poolBox, nextFrame, cancelFrame]);

  return { over: fixed && covered };
}
