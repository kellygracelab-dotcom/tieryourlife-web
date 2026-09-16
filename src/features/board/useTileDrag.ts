import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  hold,
  idle,
  move,
  press,
  targetOf,
  TOUCH_HOLD_MS,
  type DragState,
  type Point,
} from "./drag";
import type { BoardAction } from "./model";

export type HitTest = (at: Point) => Element | null;

const domHitTest: HitTest = (at) => document.elementFromPoint(at.x, at.y);

export interface TileDrag {
  state: DragState;
  onPointerDown(item: number): (event: ReactPointerEvent<HTMLElement>) => void;
}

// Pointer events give mouse, finger and pen one code path; the HTML5 drag API
// has no touch support and a ghost nobody can style.
export function useTileDrag(
  dispatch: (action: BoardAction) => void,
  hitTest: HitTest = domHitTest,
): TileDrag {
  const [state, setState] = useState<DragState>(idle);
  const stateRef = useRef(state);
  stateRef.current = state;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onPointerDown = useCallback(
    (item: number) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const at = { x: event.clientX, y: event.clientY };
      const rect = event.currentTarget.getBoundingClientRect();
      const grab = {
        x: at.x - rect.left,
        y: at.y - rect.top,
        width: rect.width,
        height: rect.height,
      };
      const next = press(item, at, event.pointerType ?? "mouse", Date.now(), grab);
      setState(next);
      if (next.phase === "pressed" && next.holdUntil !== null) {
        clearHold();
        holdTimer.current = setTimeout(() => {
          setState((current) => hold(current, targetOf(hitTest(at))));
        }, TOUCH_HOLD_MS);
      }
    },
    [hitTest],
  );

  useEffect(() => {
    if (state.phase === "idle") return;

    const onMove = (event: PointerEvent) => {
      const at = { x: event.clientX, y: event.clientY };
      setState((current) => {
        const next = move(current, at, current.phase === "pressed" ? null : targetOf(hitTest(at)));
        if (next.phase === "dragging" && current.phase !== "dragging") {
          return { ...next, target: targetOf(hitTest(at)) };
        }
        return next;
      });
    };
    const finish = (drop: boolean) => {
      clearHold();
      const current = stateRef.current;
      if (drop && current.phase === "dragging" && current.target !== null) {
        if (current.target.kind === "pool") dispatch({ type: "unplace", item: current.item });
        else dispatch({ type: "place", item: current.item, tier: current.target.tier });
      }
      setState(idle);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    // Once a drag is on, the page must not scroll under the finger.
    const onTouchMove = (event: TouchEvent) => {
      if (stateRef.current.phase === "dragging") event.preventDefault();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [state.phase, dispatch, hitTest]);

  useEffect(() => clearHold, []);

  return { state, onPointerDown };
}
