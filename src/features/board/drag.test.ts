import { describe, expect, it } from "vitest";
import { hold, idle, move, NO_GRAB, press, targetOf, TOUCH_HOLD_MS, type DragState } from "./drag";

const at = (x: number, y: number) => ({ x, y });
const grab = { x: 12, y: 30, width: 64, height: 90 };

describe("drag", () => {
  it("starts a mouse drag after a small movement, not before", () => {
    const pressed = press(3, at(10, 10), "mouse", 0, grab);
    expect(move(pressed, at(13, 10), null)).toBe(pressed);
    expect(move(pressed, at(20, 10), { kind: "tier", tier: 1 })).toEqual({
      phase: "dragging",
      item: 3,
      at: at(20, 10),
      target: { kind: "tier", tier: 1 },
      grab,
    });
  });

  it("lets a finger scroll: movement before the hold ends the press", () => {
    const pressed = press(1, at(0, 0), "touch", 1000);
    expect(pressed).toMatchObject({ phase: "pressed", holdUntil: 1000 + TOUCH_HOLD_MS });
    expect(move(pressed, at(0, 5), null)).toBe(pressed);
    expect(move(pressed, at(0, 30), null)).toBe(idle);
  });

  it("turns a held finger into a drag, and a pen counts as a finger", () => {
    const pressed = press(1, at(0, 0), "pen", 0, grab);
    expect(hold(pressed, { kind: "pool" })).toEqual({
      phase: "dragging",
      item: 1,
      at: at(0, 0),
      target: { kind: "pool" },
      grab,
    });
    expect(hold(press(1, at(0, 0), "mouse", 0), null)).toMatchObject({ phase: "pressed" });
    expect(hold(idle, null)).toBe(idle);
  });

  it("follows the pointer and the target while dragging", () => {
    const dragging: DragState = {
      phase: "dragging",
      item: 0,
      at: at(0, 0),
      target: null,
      grab: NO_GRAB,
    };
    expect(move(dragging, at(50, 60), { kind: "tier", tier: 0 })).toEqual({
      phase: "dragging",
      item: 0,
      at: at(50, 60),
      target: { kind: "tier", tier: 0 },
      grab: NO_GRAB,
    });
    expect(move(idle, at(1, 1), null)).toBe(idle);
  });

  it("reads the drop target off the nearest marked element", () => {
    document.body.innerHTML =
      '<div data-drop="tier:2"><ul><li id="in-tier"></li></ul></div>' +
      '<div data-drop="pool"><span id="in-pool"></span></div>' +
      '<div data-drop="tier:x"><span id="bad"></span></div>' +
      '<p id="outside"></p>';
    expect(targetOf(document.getElementById("in-tier"))).toEqual({ kind: "tier", tier: 2 });
    expect(targetOf(document.getElementById("in-pool"))).toEqual({ kind: "pool" });
    expect(targetOf(document.getElementById("bad"))).toBeNull();
    expect(targetOf(document.getElementById("outside"))).toBeNull();
    expect(targetOf(null)).toBeNull();
  });
});
