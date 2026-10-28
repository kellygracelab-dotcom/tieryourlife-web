import { describe, expect, it } from "vitest";
import {
  boxOf,
  held,
  isMiddle,
  MIDDLE,
  moved,
  pinched,
  shownSize,
  squareOf,
  wheelZoom,
  ZOOM_MAX,
  zoomedAround,
} from "./placing";

const wide = { width: 1000, height: 500 };
const tall = { width: 600, height: 900 };
const square = { width: 400, height: 400 };

describe("placing a face in the circle", () => {
  it("first covers the circle exactly with the picture's shorter edge", () => {
    expect(shownSize(wide, 1)).toEqual({ width: 2, height: 1 });
    expect(shownSize(tall, 2)).toEqual({ width: 2, height: 3 });
    expect(boxOf(MIDDLE, wide)).toEqual({ left: -0.5, top: 0, width: 2, height: 1 });
    expect(boxOf({ zoom: 2, x: 0.25, y: -0.5 }, square)).toEqual({
      left: -0.25,
      top: -1,
      width: 2,
      height: 2,
    });
    expect(isMiddle(MIDDLE)).toBe(true);
    expect(isMiddle({ zoom: 1.1, x: 0, y: 0 })).toBe(false);
  });

  it("never leaves a gap in the circle, however far it is moved", () => {
    // A wide picture goes sideways as far as its edges, and not up or down at all.
    expect(moved(MIDDLE, 5, 5, wide)).toEqual({ zoom: 1, x: 0.5, y: 0 });
    expect(moved(MIDDLE, -5, -5, wide)).toEqual({ zoom: 1, x: -0.5, y: 0 });
    // Zoomed in twice, a square one has half a circle to spare on every side.
    expect(moved({ zoom: 2, x: 0, y: 0 }, 3, -3, square)).toEqual({ zoom: 2, x: 0.5, y: -0.5 });
    // Pulled back into the middle it is the middle, not minus nought.
    expect(moved({ zoom: 1, x: 0.3, y: 0 }, -1, 0, square)).toEqual(MIDDLE);
    // A zoom past either end is brought back too.
    expect(held({ zoom: 9, x: 0, y: 0 }, square).zoom).toBe(ZOOM_MAX);
    expect(held({ zoom: 0.5, x: 0.2, y: 0.2 }, square)).toEqual(MIDDLE);
  });

  it("zooms from 1 to 4 times around a point, keeping the part of the picture under it there", () => {
    expect(zoomedAround(MIDDLE, 2, { x: 0, y: 0 }, square)).toEqual({ zoom: 2, x: 0, y: 0 });
    // Around the circle's right edge: what was under it is under it still.
    const right = zoomedAround(MIDDLE, 2, { x: 0.5, y: 0 }, square);
    expect(right).toEqual({ zoom: 2, x: -0.5, y: 0 });
    expect((0.5 - right.x) / right.zoom).toBe((0.5 - MIDDLE.x) / MIDDLE.zoom);
    expect(zoomedAround(MIDDLE, 10, { x: 0, y: 0 }, square).zoom).toBe(ZOOM_MAX);
    // Out again, the picture goes back to covering the circle.
    expect(zoomedAround({ zoom: 2, x: 0.5, y: 0 }, 0.1, { x: 0, y: 0 }, square)).toEqual(MIDDLE);
  });

  it("follows two fingers: the point between them, and how far they spread", () => {
    const before = [
      { x: -0.1, y: 0 },
      { x: 0.1, y: 0 },
    ] as const;
    const spread = [
      { x: -0.2, y: 0 },
      { x: 0.2, y: 0 },
    ] as const;
    const slid = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
    ] as const;
    expect(pinched(MIDDLE, before, spread, square)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(pinched({ zoom: 2, x: 0, y: 0 }, before, slid, square)).toEqual({
      zoom: 2,
      x: 0.1,
      y: 0,
    });
    // Two fingers on one spot spread nothing.
    const one = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ] as const;
    expect(pinched(MIDDLE, one, one, square)).toEqual(MIDDLE);
  });

  it("zooms about a fifth for a wheel's notch, in pixels, lines or pages", () => {
    expect(wheelZoom(-100, 0)).toBeCloseTo(1.221, 3);
    expect(wheelZoom(100, 0)).toBeCloseTo(0.819, 3);
    expect(wheelZoom(-100, 0) * wheelZoom(100, 0)).toBeCloseTo(1);
    expect(wheelZoom(-3, 1)).toBeCloseTo(wheelZoom(-48, 0));
    expect(wheelZoom(1, 2)).toBeCloseTo(wheelZoom(800, 0));
  });

  it("cuts the square inside the circle from the picture's own pixels", () => {
    // Untouched: the middle square, as the phone takes it.
    expect(squareOf(MIDDLE, wide)).toEqual({ left: 250, top: 0, side: 500 });
    expect(squareOf(MIDDLE, tall)).toEqual({ left: 0, top: 150, side: 600 });
    // Zoomed twice with the picture moved left: the middle of its right half.
    expect(squareOf({ zoom: 2, x: -0.5, y: 0 }, square)).toEqual({
      left: 200,
      top: 100,
      side: 200,
    });
    expect(squareOf({ zoom: 1, x: 0.5, y: 0 }, wide)).toEqual({ left: 0, top: 0, side: 500 });
    expect(squareOf({ zoom: 3, x: 0, y: 0 }, { width: 333, height: 201 })).toEqual({
      left: 133,
      top: 67,
      side: 67,
    });
  });

  it("cuts a square that fits the picture even from a placing that would not", () => {
    expect(squareOf({ zoom: 1, x: 3, y: -3 }, wide)).toEqual({ left: 0, top: 0, side: 500 });
    expect(squareOf({ zoom: 1, x: -3, y: 3 }, tall)).toEqual({ left: 0, top: 0, side: 600 });
    expect(squareOf({ zoom: 4, x: 0, y: 0 }, { width: 2, height: 2 }).side).toBe(1);
  });
});
