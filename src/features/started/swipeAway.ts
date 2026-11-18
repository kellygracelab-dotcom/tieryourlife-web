import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { LONG_PRESS_MS } from "../boards/listMenuTriggers";

/** How far a finger goes sideways before the row follows it: the long press's own slop. */
const SWIPE_SLOP = 10;
/** How long a row takes to slide back or away; the stylesheet's transition says the same. */
export const SETTLE_MS = 200;

type Gesture = { id: number; x: number; y: number; at: number; width: number; swiping: boolean };

/**
 * A begun list swiped aside on a touch screen (artboard 45): the row follows
 * the finger either way; let go before a third of its width and it comes
 * back, past that it slides away and `onAway` runs. Only a finger, and only
 * a sideways move that starts before a long press would open the menu: a
 * move up or down is the page's scroll, a held finger is the menu's.
 */
export function useSwipeAway(onAway: () => void) {
  const [offset, setOffset] = useState(0);
  const [phase, setPhase] = useState<"still" | "drag" | "back" | "away">("still");
  const gesture = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const away = useRef(onAway);
  useEffect(() => {
    away.current = onAway;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = (next: "back" | "away", to: number) => {
    setPhase(next);
    setOffset(to);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (next === "away") away.current();
      else setPhase("still");
    }, SETTLE_MS);
  };

  return {
    offset,
    phase,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        swallow.current = false;
        if (event.pointerType !== "touch" || phase === "away") return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: Date.now(),
          width: event.currentTarget.getBoundingClientRect().width,
          swiping: false,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const now = gesture.current;
        if (now === null || event.pointerId !== now.id) return;
        const across = event.clientX - now.x;
        if (!now.swiping) {
          const down = event.clientY - now.y;
          if (Math.abs(across) <= SWIPE_SLOP && Math.abs(down) <= SWIPE_SLOP) return;
          if (Math.abs(across) <= Math.abs(down) || Date.now() - now.at >= LONG_PRESS_MS) {
            gesture.current = null;
            return;
          }
          now.swiping = true;
          window.clearTimeout(timer.current);
          setPhase("drag");
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // A finger the browser no longer knows: the row still follows the events it gets.
          }
        }
        setOffset(across);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const now = gesture.current;
        gesture.current = null;
        if (now === null || !now.swiping || event.pointerId !== now.id) return;
        swallow.current = true;
        const across = event.clientX - now.x;
        if (now.width > 0 && Math.abs(across) >= now.width / 3) {
          settle("away", Math.sign(across) * now.width);
        } else settle("back", 0);
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => {
        const now = gesture.current;
        gesture.current = null;
        if (now !== null && now.swiping && event.pointerId === now.id) settle("back", 0);
      },
      /** The click that ends a swipe: not a press on Continue under the finger. */
      onClickCapture: (event: MouseEvent) => {
        if (!swallow.current) return;
        swallow.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
