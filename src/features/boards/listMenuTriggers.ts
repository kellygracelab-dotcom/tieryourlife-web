import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { ScreenPoint } from "../tierboard/CardMenu";

/** How long a finger stays on a list before its menu opens. */
export const LONG_PRESS_MS = 500;
/** How far a finger may wander and still be a long press, not a scroll. */
const PRESS_SLOP = 10;

/**
 * A long press on a touch screen, where no right click is: Android also sends
 * a contextmenu then, Safari on an iPhone does not. The press is let go once
 * the finger moves, lifts or the page scrolls; the click after a long press
 * that opened the menu does nothing.
 */
export function useLongPress(open: (target: Element, at: ScreenPoint) => void) {
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const swallow = useRef(false);
  const stop = () => {
    if (press.current !== null) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      if (press.current !== null) window.clearTimeout(press.current.timer);
    },
    [],
  );
  return {
    onPointerDown: (event: PointerEvent) => {
      swallow.current = false;
      if (event.pointerType !== "touch") return;
      stop();
      const target = event.target as Element;
      const at = { x: event.clientX, y: event.clientY };
      press.current = {
        x: at.x,
        y: at.y,
        fired: false,
        timer: window.setTimeout(() => {
          if (press.current !== null) press.current.fired = true;
          swallow.current = true;
          open(target, at);
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (event: PointerEvent) => {
      const now = press.current;
      if (now === null || now.fired) return;
      if (Math.hypot(event.clientX - now.x, event.clientY - now.y) > PRESS_SLOP) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    /** The click that ends a long press: not a way into the list. */
    onClickCapture: (event: MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** Where a menu opened without a pointer goes: under its ⋮, or inside the list's corner. */
function besideOf(target: Element): ScreenPoint {
  const button = target.closest("[data-menu-button]");
  const box = (button ?? target.closest("li") ?? target).getBoundingClientRect();
  const rtl = getComputedStyle(target).direction === "rtl";
  if (button !== null) return { x: rtl ? box.right : box.left, y: box.bottom + 4 };
  return { x: rtl ? box.right - 12 : box.left + 12, y: box.top + 12 };
}

/**
 * Every way a list's menu opens, on the element holding the lists: a right
 * click at the pointer, a long press under the finger, the menu key or
 * Shift+F10 and a press on ⋮ beside the list. `open` says whether the target
 * has a menu; where it has none, the browser's own stays.
 */
export function useMenuTriggers(open: (target: Element, at: ScreenPoint) => boolean) {
  // A key opened it just now: the contextmenu the browser sends after the key is the same menu.
  const keyed = useRef(0);
  const long = useLongPress((target, at) => void open(target, at));
  return {
    ...long,
    onContextMenu: (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest("input, textarea") !== null) return;
      if (Date.now() - keyed.current < 1000) {
        event.preventDefault();
        return;
      }
      if (open(target, { x: event.clientX, y: event.clientY })) event.preventDefault();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const target = event.target as Element;
      if (open(target, besideOf(target))) {
        event.preventDefault();
        keyed.current = Date.now();
      }
    },
    onClick: (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest("[data-menu-button]") === null) return;
      event.preventDefault();
      open(target, besideOf(target));
    },
  };
}
