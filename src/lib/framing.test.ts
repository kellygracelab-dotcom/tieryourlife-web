import { describe, expect, it } from "vitest";
import {
  boxOf,
  CENTRED,
  cropOf,
  frameHeight,
  held,
  isCentred,
  moved,
  pinched,
  pointInFrame,
  shownSize,
  wheelZoom,
  ZOOM_MAX,
  zoomedAround,
  type Framing,
  type Stage,
} from "./framing";

const TILE = 16 / 10;
const stage = (width: number, height: number, aspect = TILE): Stage => ({
  picture: { width, height },
  aspect,
});

const wide = stage(2000, 1000);
const exact = stage(1600, 1000);
const tall = stage(1000, 2000);

/** The picture, drawn where boxOf says, still covers the whole frame. */
function covers(framing: Framing, at: Stage): boolean {
  const box = boxOf(framing, at);
  const e = 1e-9;
  return (
    box.left <= e && box.top <= e && box.left + box.width >= 1 - e && box.top + box.height >= 1 - e
  );
}

describe("framing a picture behind a 16:10 frame", () => {
  it("first covers the frame exactly, by the height of a wider picture and the width of a narrower one", () => {
    expect(frameHeight(TILE)).toBe(0.625);
    expect(shownSize(exact, 1)).toEqual({ width: 1, height: 0.625 });
    expect(shownSize(wide, 1)).toEqual({ width: 1.25, height: 0.625 });
    expect(shownSize(tall, 1)).toEqual({ width: 1, height: 2 });
    expect(shownSize(wide, 2)).toEqual({ width: 2.5, height: 1.25 });
    expect(boxOf(CENTRED, exact)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(boxOf(CENTRED, wide)).toEqual({ left: -0.125, top: 0, width: 1.25, height: 1 });
    expect(boxOf(CENTRED, tall)).toEqual({ left: 0, top: -1.1, width: 1, height: 3.2 });
    expect(isCentred(CENTRED)).toBe(true);
    expect(isCentred({ zoom: 1, x: 0.01, y: 0 })).toBe(false);
  });

  it("is generic over the frame's shape: a square frame is the face dialog's circle", () => {
    const square = stage(1000, 500, 1);
    expect(shownSize(square, 1)).toEqual({ width: 2, height: 1 });
    expect(boxOf(CENTRED, square)).toEqual({ left: -0.5, top: 0, width: 2, height: 1 });
    expect(cropOf(CENTRED, square)).toEqual({ left: 250, top: 0, width: 500, height: 500 });
    // A banner three times as wide as it is tall.
    const banner = stage(1200, 1200, 3);
    expect(cropOf(CENTRED, banner)).toEqual({ left: 0, top: 400, width: 1200, height: 400 });
  });

  it("never leaves a gap in the frame, however far it is moved", () => {
    // A wide picture goes sideways as far as its edges, and not up or down at all.
    expect(moved(CENTRED, 5, 5, wide)).toEqual({ zoom: 1, x: 0.125, y: 0 });
    expect(moved(CENTRED, -5, -5, wide)).toEqual({ zoom: 1, x: -0.125, y: 0 });
    // A tall one only up and down, by its height less the frame's.
    expect(moved(CENTRED, 5, 5, tall)).toEqual({ zoom: 1, x: 0, y: 0.6875 });
    // One of the frame's own shape has nowhere to go until it is zoomed.
    expect(moved(CENTRED, 1, 1, exact)).toEqual(CENTRED);
    const zoomed = moved({ zoom: 2, x: 0, y: 0 }, 3, -3, exact);
    expect(zoomed).toEqual({ zoom: 2, x: 0.5, y: -0.3125 });
    expect(covers(zoomed, exact)).toBe(true);
    // Pulled back into the middle it is the middle, not minus nought.
    expect(Object.is(moved({ zoom: 1, x: 0.1, y: 0 }, -1, 0, wide).x, -0.125)).toBe(true);
    expect(Object.is(moved({ zoom: 1, x: 0, y: 0 }, 0, -1, wide).y, 0)).toBe(true);
    // A zoom past either end is brought back too.
    expect(held({ zoom: 9, x: 0, y: 0 }, exact).zoom).toBe(ZOOM_MAX);
    expect(held({ zoom: 0.5, x: 0.2, y: 0.2 }, exact)).toEqual(CENTRED);
  });

  it("zooms from 1 to 4 times around a point, keeping the part of the picture under it there", () => {
    expect(zoomedAround(CENTRED, 2, { x: 0, y: 0 }, exact)).toEqual({ zoom: 2, x: 0, y: 0 });
    // Around the frame's right edge: what was under it is under it still.
    const right = zoomedAround(CENTRED, 2, { x: 0.5, y: 0 }, exact);
    expect(right).toEqual({ zoom: 2, x: -0.5, y: 0 });
    expect((0.5 - right.x) / right.zoom).toBe((0.5 - CENTRED.x) / CENTRED.zoom);
    // Around its bottom edge, which is 0.3125 below the middle.
    expect(zoomedAround(CENTRED, 2, { x: 0, y: 0.3125 }, exact)).toEqual({
      zoom: 2,
      x: 0,
      y: -0.3125,
    });
    expect(zoomedAround(CENTRED, 10, { x: 0, y: 0 }, exact).zoom).toBe(ZOOM_MAX);
    // Out again, the picture goes back to covering the frame.
    expect(zoomedAround({ zoom: 2, x: 0.5, y: 0 }, 0.1, { x: 0, y: 0 }, exact)).toEqual(CENTRED);
    // However it is turned, it covers.
    let framing = CENTRED;
    for (const [factor, x, y] of [
      [3, 0.4, -0.3],
      [0.7, -0.5, 0.31],
      [1.9, 0.1, 0.2],
      [0.2, 0.5, 0.5],
    ] as const) {
      framing = zoomedAround(framing, factor, { x, y }, wide);
      expect(covers(framing, wide)).toBe(true);
    }
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
    expect(pinched(CENTRED, before, spread, exact)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(pinched({ zoom: 2, x: 0, y: 0 }, before, slid, exact)).toEqual({
      zoom: 2,
      x: 0.1,
      y: 0,
    });
    // Two fingers on one spot spread nothing.
    const one = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ] as const;
    expect(pinched({ zoom: 2, x: 0, y: 0 }, one, one, exact)).toEqual({ zoom: 2, x: 0, y: 0 });
  });

  it("zooms in for a wheel turned away and out for one turned towards, whatever it counts in", () => {
    expect(wheelZoom(-100, 0)).toBeCloseTo(Math.exp(0.2));
    expect(wheelZoom(100, 0)).toBeCloseTo(Math.exp(-0.2));
    expect(wheelZoom(-3, 1)).toBeCloseTo(wheelZoom(-48, 0));
    expect(wheelZoom(1, 2)).toBeCloseTo(wheelZoom(800, 0));
    expect(wheelZoom(0, 0)).toBe(1);
  });

  it("measures a point on screen in frame widths from the frame's middle, both ways", () => {
    const box = { left: 100, top: 50, width: 512, height: 320 };
    expect(pointInFrame(box, 356, 210)).toEqual({ x: 0, y: 0 });
    expect(pointInFrame(box, 612, 370)).toEqual({ x: 0.5, y: 0.3125 });
    expect(pointInFrame(box, 100, 50)).toEqual({ x: -0.5, y: -0.3125 });
    // Before layout there is nothing to measure against.
    expect(pointInFrame({ left: 0, top: 0, width: 0, height: 0 }, 1, 1)).toBeNull();
  });

  it("crops what is inside the frame, in the picture's own pixels, always of the frame's shape", () => {
    expect(cropOf(CENTRED, exact)).toEqual({ left: 0, top: 0, width: 1600, height: 1000 });
    expect(cropOf(CENTRED, wide)).toEqual({ left: 200, top: 0, width: 1600, height: 1000 });
    expect(cropOf({ zoom: 2, x: 0, y: 0 }, wide)).toEqual({
      left: 600,
      top: 250,
      width: 800,
      height: 500,
    });
    // Moved as far right as it goes, the crop is the picture's left edge.
    expect(cropOf(moved(CENTRED, 1, 0, wide), wide)).toEqual({
      left: 0,
      top: 0,
      width: 1600,
      height: 1000,
    });
    expect(cropOf(moved(CENTRED, -1, 0, wide), wide).left).toBe(400);
    // Zoomed four times into the top-left corner.
    const corner = held({ zoom: 4, x: 9, y: 9 }, exact);
    expect(cropOf(corner, exact)).toEqual({ left: 0, top: 0, width: 400, height: 250 });
    // A tall picture's middle, rounded to the pixel and kept inside it.
    expect(cropOf(CENTRED, tall)).toEqual({ left: 0, top: 688, width: 1000, height: 625 });
    const bottom = cropOf(moved(CENTRED, 0, -5, tall), tall);
    expect(bottom.top + bottom.height).toBe(2000);
  });

  it("keeps the crop inside the picture for any framing it is handed, held or not", () => {
    const odd = stage(1203, 777);
    for (const framing of [
      CENTRED,
      { zoom: 3.7, x: 0.9, y: -0.9 },
      { zoom: 1.13, x: -0.07, y: 0.02 },
      { zoom: 4, x: -2, y: 2 },
    ]) {
      const crop = cropOf(held(framing, odd), odd);
      expect(crop.left).toBeGreaterThanOrEqual(0);
      expect(crop.top).toBeGreaterThanOrEqual(0);
      expect(crop.left + crop.width).toBeLessThanOrEqual(1203);
      expect(crop.top + crop.height).toBeLessThanOrEqual(777);
      expect(crop.width / crop.height).toBeCloseTo(TILE, 1);
    }
  });
});
