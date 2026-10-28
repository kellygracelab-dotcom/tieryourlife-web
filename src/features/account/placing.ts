import type { PixelSquare } from "../../lib/pictures";

/** As far as a picture zooms in: four times the size that just covers the circle. */
export const ZOOM_MAX = 4;
/** One press of + or − zooms by a tenth. */
export const ZOOM_STEP = 1.1;
/** One press of an arrow moves the picture this far on screen; with Shift, the long step. */
export const NUDGE_PX = 8;
export const NUDGE_LONG_PX = 32;
/** A wheel's notch is some 100 px; this many make the picture e times larger or smaller. */
const WHEEL_PX_PER_E = 500;
/** A wheel that counts in lines or pages, in pixels. */
const LINE_PX = 16;
const PAGE_PX = 800;

/**
 * Where a picture sits behind the circle, in the circle's own units: the
 * circle is 1 across, the picture at zoom 1 just covers it (its shorter edge
 * as long as the circle is wide), and x, y move the picture's middle from the
 * circle's. Kept in these units, as the phone keeps it, so a window crossing
 * 600 px, where the circle changes size, keeps the same face.
 */
export interface Placing {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A place in the circle's units, from its middle. */
export interface Point {
  x: number;
  y: number;
}

/** Nothing moved yet: the middle square, at the size that just covers the circle. */
export const MIDDLE: Placing = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const isMiddle = (placing: Placing): boolean =>
  placing.zoom === MIDDLE.zoom && placing.x === MIDDLE.x && placing.y === MIDDLE.y;

/** The picture's size behind the circle at a zoom, in the circle's units. */
export function shownSize(picture: Size, zoom: number): Size {
  const shorter = Math.min(picture.width, picture.height);
  return { width: (picture.width / shorter) * zoom, height: (picture.height / shorter) * zoom };
}

/**
 * Held where the picture still covers the circle's whole square, so the cut
 * never has a gap at an edge, and zoomed no less than 1 and no more than 4.
 */
export function held(placing: Placing, picture: Size): Placing {
  const zoom = clamp(placing.zoom, 1, ZOOM_MAX);
  const shown = shownSize(picture, zoom);
  const reachX = (shown.width - 1) / 2;
  const reachY = (shown.height - 1) / 2;
  // Plus nought: a clamp can answer -0, and a picture put back in the middle should be the middle.
  return {
    zoom,
    x: clamp(placing.x, -reachX, reachX) + 0,
    y: clamp(placing.y, -reachY, reachY) + 0,
  };
}

/** Moved by dx, dy in the circle's units, then held. */
export const moved = (placing: Placing, dx: number, dy: number, picture: Size): Placing =>
  held({ ...placing, x: placing.x + dx, y: placing.y + dy }, picture);

/**
 * Zoomed by a factor around a point, so the part of the picture under the
 * point stays under it, then held.
 */
export function zoomedAround(
  placing: Placing,
  factor: number,
  point: Point,
  picture: Size,
): Placing {
  const zoom = clamp(placing.zoom * factor, 1, ZOOM_MAX);
  const grown = zoom / placing.zoom;
  return held(
    {
      zoom,
      x: point.x - (point.x - placing.x) * grown,
      y: point.y - (point.y - placing.y) * grown,
    },
    picture,
  );
}

/**
 * Two fingers that moved from `before` to `after`: the picture follows the
 * point between them and grows as far as they spread, around that point.
 */
export function pinched(
  placing: Placing,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
  picture: Size,
): Placing {
  const middle = ([a, b]: readonly [Point, Point]): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const apart = ([a, b]: readonly [Point, Point]): number => Math.hypot(a.x - b.x, a.y - b.y);
  const from = middle(before);
  const to = middle(after);
  const spread = apart(before) === 0 ? 1 : apart(after) / apart(before);
  return zoomedAround(moved(placing, to.x - from.x, to.y - from.y, picture), spread, to, picture);
}

/** A wheel's turn as a zoom: away from the person zooms in, towards them out. */
export function wheelZoom(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  return Math.exp(-pixels / WHEEL_PX_PER_E);
}

/** Where the picture is drawn, in the circle's units from the circle's top-left corner. */
export function boxOf(placing: Placing, picture: Size): Size & { left: number; top: number } {
  const shown = shownSize(picture, placing.zoom);
  return {
    ...shown,
    left: 0.5 + placing.x - shown.width / 2,
    top: 0.5 + placing.y - shown.height / 2,
  };
}

/**
 * The square inside the circle, in the picture's own pixels: the part that
 * becomes the face. Rounded, and always a square that fits the picture,
 * whatever rounding would leave hanging over an edge.
 */
export function squareOf(placing: Placing, picture: Size): PixelSquare {
  const shown = shownSize(picture, placing.zoom);
  const shorter = Math.min(picture.width, picture.height);
  // The circle's width in the picture's pixels.
  const unit = shorter / placing.zoom;
  const side = clamp(Math.round(unit), 1, shorter);
  return {
    left: clamp(Math.round((shown.width / 2 - placing.x - 0.5) * unit), 0, picture.width - side),
    top: clamp(Math.round((shown.height / 2 - placing.y - 0.5) * unit), 0, picture.height - side),
    side,
  };
}
