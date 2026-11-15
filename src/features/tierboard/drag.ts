export interface Point {
  x: number;
  y: number;
}

/** `index`: where among the row's (or the pool's) other cards the dragged one would land. */
export type DropTarget =
  { kind: "tier"; tier: number; index: number } | { kind: "pool"; index: number } | null;

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
/** Two taps on one card, or on one tier's band, this close together are a double tap. */
export const DOUBLE_TAP_MS = 300;

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

const sameTarget = (a: DropTarget, b: DropTarget): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.index === b.index &&
    (a.kind === "pool" ? b.kind === "pool" : b.kind === "tier" && a.tier === b.tier));

/**
 * Whether the board would draw two states of a drag alike: the same card
 * held, over the same place. Where the pointer is is the ghost's alone, so a
 * move within one place draws nothing else.
 */
export function sameDrawing(a: DragState, b: DragState): boolean {
  if (a === b) return true;
  if (a.phase !== "dragging" || b.phase !== "dragging") return false;
  return a.item === b.item && a.grab === b.grab && sameTarget(a.target, b.target);
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

type Box = Pick<CardBox, "left" | "right" | "top" | "bottom">;

const middleOf = (box: Box): number => (box.left + box.right) / 2;

/**
 * Whether a card comes before the point in reading order: it is on a line
 * above, or on the point's line with its turning edge on the reading side of
 * the point, left in English, right in Arabic.
 *
 * On the line of the place the carried card stands in (`held`), a card turns
 * at its edge nearer that place: a card before it at its far edge, a card
 * after it at its near edge. The carried card's middle passing a neighbour's
 * edge takes it one place over, the same way left as right, a little over
 * half a card's travel; drawn there, the neighbour's other edge is the line
 * back, a gap away, so the place does not flicker between the two. Elsewhere
 * a card turns at its middle.
 */
function comesBefore(box: Box, held: Box | null, at: Point, rtl: boolean): boolean {
  if (box.bottom <= at.y) return true;
  if (box.top > at.y) return false;
  let edge = middleOf(box);
  if (held !== null && held.top < box.bottom && box.top < held.bottom) {
    const beforeHeld = rtl ? middleOf(box) > middleOf(held) : middleOf(box) < middleOf(held);
    edge = beforeHeld === rtl ? box.left : box.right;
  }
  return rtl ? edge > at.x : edge < at.x;
}

/**
 * How many of a row's cards come before the point, in reading order (see
 * `comesBefore`). Rows wrap, so the line matters before the side.
 */
export function insertionIndex(
  boxes: readonly CardBox[],
  at: Point,
  rtl: boolean,
  held: Box | null = null,
): number {
  let before = 0;
  for (const box of boxes) if (comesBefore(box, held, at, rtl)) before += 1;
  return before;
}

/**
 * The point a carried card is placed by: its middle, where it was taken hold
 * of known, so a card held by its right edge goes left as soon as one held by
 * its left edge goes right. Otherwise the pointer.
 */
export function placedBy(at: Point, grab: Grab = NO_GRAB): Point {
  if (!(grab.width > 0 && grab.height > 0)) return at;
  return { x: at.x - grab.x + grab.width / 2, y: at.y - grab.y + grab.height / 2 };
}

/**
 * What is under the pointer: a tier or the pool, and the place in it, or
 * nothing. The card being dragged does not count among the row's cards: its
 * place is where it would land without it. The place is found by the carried
 * card's middle (`placedBy`), the row by the pointer.
 */
export function targetOf(
  element: Element | null,
  pointer?: Point,
  dragged?: number,
  grab?: Grab,
): DropTarget {
  const zone = element?.closest<HTMLElement>("[data-drop]");
  const drop = zone?.dataset.drop;
  if (zone == null || drop === undefined) return null;
  const inPool = drop === "pool";
  const tier = inPool ? -1 : Number(drop.replace("tier:", ""));
  if (!Number.isInteger(tier)) return null;
  const toward = (index: number): DropTarget =>
    inPool ? { kind: "pool", index } : { kind: "tier", tier, index };
  if (pointer === undefined) return toward(Number.MAX_SAFE_INTEGER);
  const at = placedBy(pointer, grab);
  const list = inPool ? ".pool__items" : ".tier__items";
  const rtl = getComputedStyle(zone).direction === "rtl";
  const heldCard =
    dragged === undefined ? null : zone.querySelector(`${list} [data-item="${dragged}"]`);
  const held = heldCard?.getBoundingClientRect() ?? null;
  const row = zone.querySelector(list);
  const children = row?.children;
  if (children && children.length > 32) {
    let heldChild: Element | null = heldCard;
    while (heldChild !== null && heldChild.parentElement !== row) {
      heldChild = heldChild.parentElement;
    }
    // In order along the line: a card before the carried one turns at its far
    // edge, the carried one's place at its middle, a card after it at its near edge.
    const before = (child: Element) => {
      const box = child.getBoundingClientRect();
      return child === heldChild ? heldBefore(box, at, rtl) : comesBefore(box, held, at, rtl);
    };
    let low = 0;
    let high = children.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (before(children[mid]!)) low = mid + 1;
      else high = mid;
    }
    return toward(low - (held !== null && heldBefore(held, at, rtl) ? 1 : 0));
  }
  const boxes: CardBox[] = [];
  for (const card of zone.querySelectorAll<HTMLElement>(`${list} [data-item]`)) {
    const item = Number(card.dataset.item);
    if (item === dragged) continue;
    const rect = card.getBoundingClientRect();
    boxes.push({ item, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  return toward(insertionIndex(boxes, at, rtl, held));
}

/** The carried card's own place, in a long row's search: before the point when its middle is. */
const heldBefore = (held: Box, at: Point, rtl: boolean): boolean =>
  held.bottom <= at.y ||
  (held.top <= at.y && (rtl ? middleOf(held) > at.x : middleOf(held) < at.x));

/**
 * A row's cards as drawn while a card is carried, the same for a tier and
 * for the pool, from wherever the card came: over this row, the card stands
 * where it would land, faded, and the others make room for it; anywhere else
 * while it is carried (`landing`), it is gone from here, as it will be once
 * let go over another row. The board carries it so from the moment it is
 * lifted: a card that left its row only over another row came back between
 * two, and its row moved at every crossing. Without `landing` it stays where
 * it was.
 */
export function carried(
  row: readonly number[],
  lifted: number | null,
  dropAt: number | null,
  landing: boolean,
): readonly number[] {
  if (lifted === null || (dropAt === null && !landing)) return row;
  const others = row.includes(lifted) ? row.filter((item) => item !== lifted) : row;
  if (dropAt === null) return others;
  const at = Math.min(Math.max(0, dropAt), others.length);
  return [...others.slice(0, at), lifted, ...others.slice(at)];
}
