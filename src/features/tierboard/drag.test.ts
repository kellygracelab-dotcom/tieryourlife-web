import { describe, expect, it } from "vitest";
import {
  hold,
  idle,
  insertionIndex,
  move,
  NO_GRAB,
  press,
  sameDrawing,
  targetOf,
  TOUCH_HOLD_MS,
  type DragState,
  type DropTarget,
} from "./drag";

const at = (x: number, y: number) => ({ x, y });
const grab = { x: 12, y: 30, width: 64, height: 90 };

describe("drag", () => {
  it("starts a mouse drag after a small movement, not before", () => {
    const pressed = press(3, at(10, 10), "mouse", 0, grab);
    expect(move(pressed, at(13, 10), null)).toBe(pressed);
    expect(move(pressed, at(20, 10), { kind: "tier", tier: 1, index: 0 })).toEqual({
      phase: "dragging",
      item: 3,
      at: at(20, 10),
      target: { kind: "tier", tier: 1, index: 0 },
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
    expect(move(dragging, at(50, 60), { kind: "tier", tier: 0, index: 0 })).toEqual({
      phase: "dragging",
      item: 0,
      at: at(50, 60),
      target: { kind: "tier", tier: 0, index: 0 },
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
    expect(targetOf(document.getElementById("in-tier"))).toEqual({
      kind: "tier",
      tier: 2,
      index: Number.MAX_SAFE_INTEGER,
    });
    expect(targetOf(document.getElementById("in-pool"))).toEqual({ kind: "pool" });
    expect(targetOf(document.getElementById("bad"))).toBeNull();
    expect(targetOf(document.getElementById("outside"))).toBeNull();
    expect(targetOf(null)).toBeNull();
  });
});

describe("insertionIndex", () => {
  // Two lines of three cards, 60 wide with 10 between, 90 tall with 10 between.
  const boxes = [0, 1, 2, 3, 4, 5].map((item) => {
    const line = Math.floor(item / 3);
    const column = item % 3;
    return {
      item,
      left: column * 70,
      right: column * 70 + 60,
      top: line * 100,
      bottom: line * 100 + 90,
    };
  });

  it("counts the cards before the point in reading order, line by line", () => {
    expect(insertionIndex(boxes, at(5, 40), false)).toBe(0);
    expect(insertionIndex(boxes, at(40, 40), false)).toBe(1);
    expect(insertionIndex(boxes, at(200, 40), false)).toBe(3);
    expect(insertionIndex(boxes, at(5, 140), false)).toBe(3);
    expect(insertionIndex(boxes, at(110, 140), false)).toBe(5);
    expect(insertionIndex(boxes, at(500, 500), false)).toBe(6);
    // Between the lines: the whole line above comes first.
    expect(insertionIndex(boxes, at(100, 95), false)).toBe(3);
  });

  it("reads from the right in Arabic", () => {
    const mirrored = boxes.map((box) => ({ ...box, left: 200 - box.right, right: 200 - box.left }));
    expect(insertionIndex(mirrored, at(195, 40), true)).toBe(0);
    expect(insertionIndex(mirrored, at(160, 40), true)).toBe(1);
    expect(insertionIndex(mirrored, at(0, 40), true)).toBe(3);
  });

  it("is the start of an empty row", () => {
    expect(insertionIndex([], at(100, 100), false)).toBe(0);
  });
});

describe("targetOf with a point", () => {
  it("places the card among the row's other cards, leaving itself out", () => {
    document.body.innerHTML =
      '<div data-drop="tier:1"><ul class="tier__items">' +
      [0, 1, 2].map((item) => `<li><button data-item="${item}"></button></li>`).join("") +
      "</ul></div>";
    document.querySelectorAll<HTMLElement>("[data-item]").forEach((card, i) => {
      card.getBoundingClientRect = () =>
        ({ left: i * 70, right: i * 70 + 60, top: 0, bottom: 90 }) as DOMRect;
    });
    const zone = document.querySelector("[data-drop]");
    expect(targetOf(zone, at(110, 40))).toEqual({ kind: "tier", tier: 1, index: 2 });
    // Card 0 is the one held: past card 1's middle is its first place.
    expect(targetOf(zone, at(110, 40), 0)).toEqual({ kind: "tier", tier: 1, index: 1 });
  });
});

it("finds the same insertion point in a long wrapped row in either reading direction", () => {
  const zone = document.createElement("div");
  zone.dataset.drop = "tier:0";
  const items = document.createElement("ul");
  items.className = "tier__items";
  zone.append(items);
  document.body.append(zone);
  for (const rtl of [false, true]) {
    zone.style.direction = rtl ? "rtl" : "ltr";
    items.replaceChildren();
    const boxes = Array.from({ length: 72 }, (_, item) => {
      const x = (rtl ? 7 - (item % 8) : item % 8) * 70;
      const y = Math.floor(item / 8) * 100;
      const box = { item, left: x, right: x + 60, top: y, bottom: y + 90 };
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.dataset.item = String(item);
      li.getBoundingClientRect = button.getBoundingClientRect = () => new DOMRect(x, y, 60, 90);
      li.append(button);
      items.append(li);
      return box;
    });
    for (const point of [at(0, -10), at(210, 130), at(100, 195), at(520, 840), at(800, 1600)]) {
      const index = insertionIndex(
        boxes.filter((b) => b.item !== 10),
        point,
        rtl,
      );
      expect(targetOf(zone, point, 10)).toEqual({ kind: "tier", tier: 0, index });
    }
  }
  zone.remove();
});

describe("sameDrawing", () => {
  const carried = (x: number, target: DropTarget, item = 3): DragState => ({
    phase: "dragging",
    item,
    at: { x, y: 0 },
    target,
    grab: NO_GRAB,
  });
  const over: DropTarget = { kind: "tier", tier: 1, index: 2 };

  it("is the same while the card stays over one place, wherever the pointer is", () => {
    expect(sameDrawing(carried(10, over), carried(80, { kind: "tier", tier: 1, index: 2 }))).toBe(
      true,
    );
    expect(sameDrawing(carried(10, { kind: "pool" }), carried(80, { kind: "pool" }))).toBe(true);
    expect(sameDrawing(carried(10, null), carried(80, null))).toBe(true);
    expect(sameDrawing(idle, idle)).toBe(true);
  });

  it("is another drawing for another place, another card, or another phase", () => {
    expect(sameDrawing(carried(10, over), carried(10, { kind: "tier", tier: 1, index: 3 }))).toBe(
      false,
    );
    expect(sameDrawing(carried(10, over), carried(10, { kind: "tier", tier: 0, index: 2 }))).toBe(
      false,
    );
    expect(sameDrawing(carried(10, over), carried(10, { kind: "pool" }))).toBe(false);
    expect(sameDrawing(carried(10, over), carried(10, null))).toBe(false);
    expect(sameDrawing(carried(10, over), carried(10, over, 4))).toBe(false);
    expect(sameDrawing(idle, carried(10, over))).toBe(false);
    const pressed = press(3, { x: 0, y: 0 }, "mouse", 0);
    expect(sameDrawing(pressed, press(3, { x: 0, y: 0 }, "mouse", 0))).toBe(false);
  });
});
