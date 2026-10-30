import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { DOUBLE_TAP_MS, MOUSE_SLOP, TOUCH_SLOP } from "./drag";
import { indexAt, middlesOf } from "./tierDrag";

/** The owner's hold on the tiers themselves, from the board. */
export interface TierEditing {
  /** The tier at `from` now belongs at `to`; by the keyboard, which goes with it. */
  move: (from: number, to: number, keyboard?: boolean) => void;
  /** Change this tier: its name, its caption, its colour. */
  open: (tier: number) => void;
  /** One more tier under the last; absent at the ceiling. */
  add?: () => void;
}

/** A finger holds a tier this long before it lifts, the phone's long press; sooner it is a scroll or a tap. */
export const TIER_HOLD_MS = 350;

interface Press {
  tier: number;
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  lifted: boolean;
}

interface Lift {
  tier: number;
  startY: number;
  dy: number;
  target: number;
  /** The rows' middles and the lifted row's height with the gap, read once: the rows move under it. */
  middles: number[];
  step: number;
}

export interface TierMove {
  /** The tier being carried, if any. */
  lifted: number | null;
  /** How far a row stands from its place right now: the carried one under the pointer, the others making room. */
  offsetOf: (tier: number) => number;
  onPointerDown: (tier: number) => (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * The phone's gestures on a tier's band: lift it and carry it up or down (a
 * press and a move with a mouse, a long press with a finger), or open it to
 * change it: a double click with a mouse, a tap with a finger when no card is
 * picked (`tapOpens`; with one picked, a tap on a row places the card).
 * Nothing moves in the board's order until the tier is let go; meanwhile the
 * rows only stand aside, so a board keyed by its tiers is not rebuilt under
 * the pointer.
 */
export function useTierMove(
  board: RefObject<HTMLElement | null>,
  editing: TierEditing | undefined,
  tapOpens = true,
): TierMove {
  const opensOnTap = useRef(tapOpens);
  useEffect(() => {
    opensOnTap.current = tapOpens;
  });
  const [lift, setLift] = useState<Lift | null>(null);
  const press = useRef<Press | null>(null);
  const carried = useRef<Lift | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ tier: number; at: number } | null>(null);

  const show = useCallback((next: Lift | null) => {
    carried.current = next;
    setLift(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const begin = useCallback(
    (held: Press) => {
      const rows = [...(board.current?.querySelectorAll(":scope > [data-drop^='tier:']") ?? [])];
      const row = rows[held.tier];
      if (board.current === null || row === undefined) return;
      held.lifted = true;
      const gap = parseFloat(getComputedStyle(board.current).rowGap) || 0;
      show({
        tier: held.tier,
        startY: held.y,
        dy: 0,
        target: held.tier,
        middles: middlesOf(rows),
        step: row.getBoundingClientRect().height + gap,
      });
      if (held.touch) navigator.vibrate?.(10);
    },
    [board, show],
  );

  const onPointerDown = useCallback(
    (tier: number) => (event: ReactPointerEvent<HTMLElement>) => {
      if (editing === undefined || event.button !== 0) return;
      // The band's own buttons are pressed, not held.
      if (event.target instanceof Element && event.target.closest("button") !== null) return;
      const held: Press = {
        tier,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        touch: (event.pointerType ?? "mouse") !== "mouse",
        lifted: false,
      };
      press.current = held;
      stopTimer();
      if (held.touch) {
        timer.current = setTimeout(() => {
          if (press.current === held) begin(held);
        }, TIER_HOLD_MS);
      }
    },
    [begin, editing, stopTimer],
  );

  useEffect(() => {
    if (editing === undefined) return;
    const onMove = (event: PointerEvent) => {
      const held = press.current;
      if (held === null || event.pointerId !== held.pointerId) return;
      if (!held.lifted) {
        const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y);
        if (held.touch) {
          // A finger that moves before the hold is scrolling the page.
          if (moved > TOUCH_SLOP) {
            stopTimer();
            press.current = null;
          }
          return;
        }
        if (moved <= MOUSE_SLOP) return;
        begin(held);
      }
      const now = carried.current;
      if (now === null) return;
      show({
        ...now,
        dy: event.clientY - now.startY,
        target: indexAt(event.clientY, now.middles, now.tier),
      });
    };
    const onUp = (event: PointerEvent) => {
      const held = press.current;
      if (held === null || event.pointerId !== held.pointerId) return;
      stopTimer();
      press.current = null;
      if (held.lifted) {
        const now = carried.current;
        show(null);
        if (now !== null && now.target !== now.tier) editing.move(now.tier, now.target);
        return;
      }
      if (held.touch) {
        if (opensOnTap.current) editing.open(held.tier);
        return;
      }
      const at = Date.now();
      const before = lastTap.current;
      if (before !== null && before.tier === held.tier && at - before.at < DOUBLE_TAP_MS) {
        lastTap.current = null;
        editing.open(held.tier);
      } else {
        lastTap.current = { tier: held.tier, at };
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (press.current === null || event.pointerId !== press.current.pointerId) return;
      stopTimer();
      press.current = null;
      show(null);
    };
    // A long press is the phone's menu for the text under it; on a band it is a lift.
    const onContextMenu = (event: MouseEvent) => {
      if (press.current?.touch === true) event.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [begin, editing, show, stopTimer]);

  // While a tier is carried the page must not scroll under the finger; a
  // listener that may cancel slows every scroll, so it lives only that long.
  const carrying = lift !== null;
  useEffect(() => {
    if (!carrying) return;
    const onTouchMove = (event: TouchEvent) => event.preventDefault();
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", onTouchMove);
  }, [carrying]);

  useEffect(() => stopTimer, [stopTimer]);

  const offsetOf = (tier: number): number => {
    if (lift === null) return 0;
    if (tier === lift.tier) return lift.dy;
    if (lift.tier < tier && tier <= lift.target) return -lift.step;
    if (lift.target <= tier && tier < lift.tier) return lift.step;
    return 0;
  };

  return { lifted: lift?.tier ?? null, offsetOf, onPointerDown };
}
