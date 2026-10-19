export interface Point {
  x: number;
  y: number;
}

/** `index`: where among the row's other cards the dragged one would land. */
export type DropTarget = { kind: "tier"; tier: number; index: number } | { kind: "pool" } | null;

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

/** A card's box on the screen, as much of it as the insertion point needs. */
export interface CardBox {
  item: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How many of a row's cards come before the point, in reading order: every
 * card on a line above it, and on its own line every card whose middle is on
 * the reading side of it — left in English, right in Arabic. Rows wrap, so
 * the line matters before the side.
 */
export function insertionIndex(boxes: readonly CardBox[], at: Point, rtl: boolean): number {
  let before = 0;
  for (const box of boxes) {
    if (box.bottom <= at.y) {
      before += 1;
    } else if (box.top <= at.y) {
      const middle = (box.left + box.right) / 2;
      if (rtl ? middle > at.x : middle < at.x) before += 1;
    }
  }
  return before;
}

/**
 * What is under the pointer: a tier and the place in it, the pool, or
 * nothing. The card being dragged does not count among the row's cards: its
 * place is where it would land without it.
 */
export function targetOf(element: Element | null, at?: Point, dragged?: number): DropTarget {
  const zone = element?.closest<HTMLElement>("[data-drop]");
  const drop = zone?.dataset.drop;
  if (zone == null || drop === undefined) return null;
  if (drop === "pool") return { kind: "pool" };
  const tier = Number(drop.replace("tier:", ""));
  if (!Number.isInteger(tier)) return null;
  if (at === undefined) return { kind: "tier", tier, index: Number.MAX_SAFE_INTEGER };
  const boxes: CardBox[] = [];
  for (const card of zone.querySelectorAll<HTMLElement>(".tier__items [data-item]")) {
    const item = Number(card.dataset.item);
    if (item === dragged) continue;
    const rect = card.getBoundingClientRect();
    boxes.push({ item, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  const rtl = getComputedStyle(zone).direction === "rtl";
  return { kind: "tier", tier, index: insertionIndex(boxes, at, rtl) };
}
