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
  /** The drag as it is right now, ahead of React's commit. */
  current(): DragState;
  /** The page moved under a still pointer: what is under it is read again. */
  nudge(): void;
}

// Pointer events give mouse, finger and pen one code path; the HTML5 drag API
// has no touch support and a ghost nobody can style.
export function useTileDrag(
  dispatch: (action: BoardAction) => void,
  hitTest: HitTest = domHitTest,
): TileDrag {
  const [state, setState] = useState<DragState>(idle);
  // The truth is here, and the state above only draws it. Events can come
  // faster than React commits: a quick flick delivered its pointerup while the
  // committed state still said "pressed", and the card fell back to the pool.
  const latest = useRef<DragState>(idle);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const become = useCallback((next: DragState) => {
    latest.current = next;
    setState(next);
  }, []);

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
      become(next);
      if (next.phase === "pressed" && next.holdUntil !== null) {
        clearHold();
        holdTimer.current = setTimeout(() => {
          become(hold(latest.current, targetOf(hitTest(at))));
        }, TOUCH_HOLD_MS);
      }
    },
    [become, hitTest],
  );

  // Always listening: a listener added after the press can miss the release.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = latest.current;
      if (current.phase === "idle") return;
      const at = { x: event.clientX, y: event.clientY };
      const next = move(current, at, current.phase === "pressed" ? null : targetOf(hitTest(at)));
      become(
        next.phase === "dragging" && current.phase !== "dragging"
          ? { ...next, target: targetOf(hitTest(at)) }
          : next,
      );
    };
    const finish = (drop: boolean) => {
      clearHold();
      const current = latest.current;
      if (current.phase === "idle") return;
      if (drop && current.phase === "dragging" && current.target !== null) {
        if (current.target.kind === "pool") dispatch({ type: "unplace", item: current.item });
        else dispatch({ type: "place", item: current.item, tier: current.target.tier });
      }
      become(idle);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [become, dispatch, hitTest]);

  // Once a drag is on, the page must not scroll under the finger. A listener
  // that may cancel slows every scroll down, so it lives only while a card is held.
  const held = state.phase !== "idle";
  useEffect(() => {
    if (!held) return;
    const onTouchMove = (event: TouchEvent) => {
      if (latest.current.phase === "dragging") event.preventDefault();
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", onTouchMove);
  }, [held]);

  useEffect(() => clearHold, []);

  const current = useCallback(() => latest.current, []);
  const nudge = useCallback(() => {
    const now = latest.current;
    if (now.phase !== "dragging") return;
    become(move(now, now.at, targetOf(hitTest(now.at))));
  }, [become, hitTest]);

  return { state, onPointerDown, current, nudge };
}
