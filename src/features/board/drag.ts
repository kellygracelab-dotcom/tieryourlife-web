export interface Point {
  x: number;
  y: number;
}

export type DropTarget = { kind: "tier"; tier: number } | { kind: "pool" } | null;

/** Where the card was taken hold of, and how big it is, so the ghost moves as the card itself. */
export interface Grab {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DragState =
  | { phase: "idle" }
  | { phase: "pressed"; item: number; start: Point; holdUntil: number | null; grab: Grab }
  | { phase: "dragging"; item: number; at: Point; target: DropTarget; grab: Grab };

export const NO_GRAB: Grab = { x: 0, y: 0, width: 0, height: 0 };

export const MOUSE_SLOP = 6;
export const TOUCH_SLOP = 8;
// The phone's own long-press, so a finger that only wanted to scroll gets to.
export const TOUCH_HOLD_MS = 150;

export const idle: DragState = { phase: "idle" };

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function press(
  item: number,
  at: Point,
  pointerType: string,
  now: number,
  grab: Grab = NO_GRAB,
): DragState {
  const touch = pointerType === "touch" || pointerType === "pen";
  return { phase: "pressed", item, start: at, holdUntil: touch ? now + TOUCH_HOLD_MS : null, grab };
}

/** What a movement means while pressed: nothing yet, a drag, or a scroll to let go of. */
export function move(state: DragState, at: Point, target: DropTarget): DragState {
  if (state.phase === "dragging") return { ...state, at, target };
  if (state.phase !== "pressed") return state;
  const moved = distance(state.start, at);
  if (state.holdUntil === null) {
    return moved > MOUSE_SLOP
      ? { phase: "dragging", item: state.item, at, target, grab: state.grab }
      : state;
  }
  return moved > TOUCH_SLOP ? idle : state;
}

/** The hold timer fired: a finger that stayed put is now dragging. */
export function hold(state: DragState, target: DropTarget): DragState {
  if (state.phase !== "pressed" || state.holdUntil === null) return state;
  return { phase: "dragging", item: state.item, at: state.start, target, grab: state.grab };
}

export function targetOf(element: Element | null): DropTarget {
  const drop = element?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
  if (drop === undefined) return null;
  if (drop === "pool") return { kind: "pool" };
  const tier = Number(drop.replace("tier:", ""));
  return Number.isInteger(tier) ? { kind: "tier", tier } : null;
}
