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
  sameDrawing,
  targetOf,
  TOUCH_HOLD_MS,
  type DragState,
  type Point,
} from "./drag";
import type { BoardAction } from "./model";

export type HitTest = (at: Point) => Element | null;

const domHitTest: HitTest = (at) => document.elementFromPoint(at.x, at.y);

export interface TileDrag {
  /**
   * The drag as the board draws it: the card held and the place it would
   * land. It changes when they do; where the pointer is, `current` says.
   */
  state: DragState;
  onPointerDown(item: number): (event: ReactPointerEvent<HTMLElement>) => void;
  /** The drag as it is right now, ahead of React's commit. */
  current(): DragState;
  /** Told of every change of `current`, each move of the pointer among them. */
  subscribe(onChange: () => void): () => void;
  /** The page moved under a still pointer: what is under it is read again. */
  nudge(): void;
}

/**
 * A card dragged along its row stands under the pointer when it is let go,
 * so the release lands on the card itself and the browser calls the press a
 * click; a drag selects nothing. The click comes in the same task as the
 * release, so the guard is gone by the next one.
 */
function swallowClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    stop();
  };
  // A new press, or the next task: no click of this release is coming any more.
  const stop = () => {
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", stop, { capture: true });
  };
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", stop, { capture: true });
  setTimeout(stop, 0);
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
  // Every pointermove changes where the card is; the board, some 2,000 tiles
  // on a big list, is drawn again only when what it shows changes. The ghost
  // follows the pointer by itself.
  const drawn = useRef<DragState>(idle);
  const watchers = useRef(new Set<() => void>());

  const become = useCallback((next: DragState) => {
    latest.current = next;
    for (const watcher of watchers.current) watcher();
    if (sameDrawing(drawn.current, next)) return;
    drawn.current = next;
    setState(next);
  }, []);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

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
          become(hold(latest.current, targetOf(hitTest(at), at, item)));
        }, TOUCH_HOLD_MS);
      }
    },
    [become, clearHold, hitTest],
  );

  // Always listening: a listener added after the press can miss the release.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = latest.current;
      if (current.phase === "idle") return;
      const at = { x: event.clientX, y: event.clientY };
      const under = () => targetOf(hitTest(at), at, current.item);
      const next = move(current, at, current.phase === "pressed" ? null : under());
      become(
        next.phase === "dragging" && current.phase !== "dragging"
          ? { ...next, target: under() }
          : next,
      );
    };
    const finish = (drop: boolean) => {
      clearHold();
      const current = latest.current;
      if (current.phase === "idle") return;
      if (drop && current.phase === "dragging") swallowClick();
      if (drop && current.phase === "dragging" && current.target !== null) {
        if (current.target.kind === "pool") dispatch({ type: "unplace", item: current.item });
        else {
          const { tier, index } = current.target;
          dispatch({ type: "place", item: current.item, tier, index });
        }
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
  }, [become, clearHold, dispatch, hitTest]);

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

  useEffect(() => clearHold, [clearHold]);

  const current = useCallback(() => latest.current, []);
  const subscribe = useCallback((onChange: () => void) => {
    const all = watchers.current;
    all.add(onChange);
    return () => void all.delete(onChange);
  }, []);
  const nudge = useCallback(() => {
    const now = latest.current;
    if (now.phase !== "dragging") return;
    become(move(now, now.at, targetOf(hitTest(now.at), now.at, now.item)));
  }, [become, hitTest]);

  return { state, onPointerDown, current, subscribe, nudge };
}
